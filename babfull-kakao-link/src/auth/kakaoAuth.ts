import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { KakaoConfig } from "../config/env.js";

const execFileAsync = promisify(execFile);
const TOKEN_PATH = resolve(process.cwd(), ".local/kakao-tokens.json");

interface KakaoTokenResponse {
  token_type: string;
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

interface StoredTokens extends KakaoTokenResponse {
  obtained_at: number;
}

function tokenRequestBody(config: KakaoConfig): URLSearchParams {
  const params = new URLSearchParams({ client_id: config.restApiKey });
  if (config.clientSecret) params.set("client_secret", config.clientSecret);
  return params;
}

async function requestTokens(params: URLSearchParams): Promise<KakaoTokenResponse> {
  const response = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: params,
  });
  const payload = (await response.json()) as KakaoTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `카카오 토큰 발급 실패 (${response.status}): ${payload.error_description ?? payload.error ?? "알 수 없는 오류"}`,
    );
  }
  return payload;
}

async function saveTokens(tokens: KakaoTokenResponse): Promise<StoredTokens> {
  const stored = { ...tokens, obtained_at: Date.now() };
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return stored;
}

async function loadTokens(): Promise<StoredTokens | null> {
  try {
    return JSON.parse(await readFile(TOKEN_PATH, "utf8")) as StoredTokens;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function refreshAccessToken(
  config: KakaoConfig,
  refreshToken: string,
): Promise<StoredTokens> {
  const params = tokenRequestBody(config);
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", refreshToken);
  const refreshed = await requestTokens(params);
  return saveTokens({
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? refreshToken,
  });
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await execFileAsync(command, args);
}

async function receiveAuthorizationCode(
  redirectUri: string,
  state: string,
  onReady: () => Promise<void>,
): Promise<string> {
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(redirect.hostname)) {
    throw new Error("로컬 PoC의 KAKAO_REDIRECT_URI는 localhost 또는 127.0.0.1 HTTP 주소여야 합니다.");
  }

  return new Promise((resolveCode, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("SIGINT", onInterrupt);
      server.close();
      action();
    };
    const onInterrupt = (): void => finish(() => reject(new Error("카카오 로그인이 취소되었습니다.")));
    const timer = setTimeout(() => {
      finish(() => reject(new Error("카카오 로그인 대기 시간이 3분을 초과했습니다.")));
    }, 180_000);

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirect.origin);
      if (requestUrl.pathname !== redirect.pathname) {
        response.writeHead(404).end("Not found");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const returnedState = requestUrl.searchParams.get("state");
      const oauthError = requestUrl.searchParams.get("error_description");
      const valid = Boolean(code && returnedState === state);

      response.writeHead(valid ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(
        valid
          ? "카카오 인증 완료\n이 창을 닫고 터미널로 돌아가세요."
          : `카카오 인증 실패\n${oauthError ?? "state 또는 인가 코드가 올바르지 않습니다."}`,
      );
      finish(() => {
        if (valid) resolveCode(code!);
        else reject(new Error(oauthError ?? "카카오 OAuth 응답 검증에 실패했습니다."));
      });
    });

    server.on("error", (error) => {
      finish(() => reject(error));
    });
    process.once("SIGINT", onInterrupt);
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      onReady().catch((error: unknown) => {
        finish(() => reject(error));
      });
    });
  });
}

async function login(config: KakaoConfig): Promise<StoredTokens> {
  const state = randomBytes(24).toString("hex");
  const authorizeUrl = new URL("https://kauth.kakao.com/oauth/authorize");
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: config.restApiKey,
    redirect_uri: config.redirectUri,
    scope: "talk_message",
    state,
  }).toString();

  console.log("\n브라우저에서 카카오 로그인과 talk_message 동의를 완료해 주세요.");
  const code = await receiveAuthorizationCode(config.redirectUri, state, () =>
    openBrowser(authorizeUrl.toString()),
  );

  const params = tokenRequestBody(config);
  params.set("grant_type", "authorization_code");
  params.set("redirect_uri", config.redirectUri);
  params.set("code", code);
  return saveTokens(await requestTokens(params));
}

export async function getAccessToken(config: KakaoConfig): Promise<string> {
  const stored = await loadTokens();
  const expiresAt = stored ? stored.obtained_at + stored.expires_in * 1_000 : 0;
  if (stored && Date.now() < expiresAt - 60_000) return stored.access_token;
  if (stored?.refresh_token) {
    try {
      return (await refreshAccessToken(config, stored.refresh_token)).access_token;
    } catch {
      console.warn("저장된 토큰을 갱신할 수 없어 카카오 로그인을 다시 진행합니다.");
    }
  }
  return (await login(config)).access_token;
}
