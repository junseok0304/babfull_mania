import CryptoJS from "crypto-js";
import { load } from "cheerio";
import { FormData, request, type Dispatcher } from "undici";

// Local PoC adapted from the MIT-licensed cjh980402/kakao-link 2.0.1 flow.
// Kakao does not expose this room picker as a public API. Never deploy this client.
const LOGIN_URL =
  "https://accounts.kakao.com/login?continue=https%3A%2F%2Faccounts.kakao.com%2Fweblogin%2Faccount%2Finfo";
const PICKER_URL = "https://sharer.kakao.com/talk/friends/picker/link";
const CHATS_URL = "https://sharer.kakao.com/api/talk/chats";
const SEND_URL = "https://sharer.kakao.com/api/talk/message/link";

export interface RoomSummary {
  id: string;
  title: string;
  memberCount?: number;
}

export interface RoomTemplateRequest {
  link_ver: "4.0";
  template_id: number;
  template_args: Record<string, string>;
}

interface PickerContext {
  csrfToken: string;
  securityKey: string;
  validatedTalkLink: unknown;
  rooms: RoomSummary[];
}

interface KakaoChatPayload {
  chats?: unknown;
  securityKey?: unknown;
}

export interface RoomCapabilityReport {
  supported: "experimental";
  reason: string;
}

export function inspectRoomCapability(): RoomCapabilityReport {
  return {
    supported: "experimental",
    reason:
      "공식 API 기능은 아니지만 kakao-link 2.0.1이 사용하는 공유 피커 내부 응답에서 실제 방 title/id를 조회할 수 있어 로컬 1회 테스트만 지원합니다.",
  };
}

export function normalizeRooms(value: unknown): RoomSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RoomSummary[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.title !== "string") return [];
    const title = candidate.title.trim();
    if (!title) return [];
    const memberCount =
      typeof candidate.memberCount === "number" && Number.isFinite(candidate.memberCount)
        ? candidate.memberCount
        : undefined;
    return [{ id: candidate.id, title, memberCount }];
  });
}

export class UnofficialRoomClient {
  readonly #javascriptKey: string;
  readonly #userAgent: string;
  readonly #cookies = new Map<string, string>();
  #referer = "https://accounts.kakao.com";
  #picker?: PickerContext;

  constructor(javascriptKey: string, domain: string) {
    if (!/^[a-fA-F0-9]{32}$/.test(javascriptKey)) {
      throw new Error("KAKAO_JAVASCRIPT_KEY는 32자리 JavaScript 키여야 합니다.");
    }
    if (!/^https?:\/\/.+/.test(domain)) {
      throw new Error("KAKAO_SHARE_DOMAIN은 http(s) URL이어야 합니다.");
    }
    this.#javascriptKey = javascriptKey;
    this.#userAgent =
      `sdk/1.36.6 os/javascript lang/ko-KR device/Node origin/${encodeURIComponent(domain)}`;
  }

  async login(email: string, password: string): Promise<void> {
    if (!email || !password) throw new Error("카카오 계정 이메일과 비밀번호가 필요합니다.");
    const loginPage = await request(LOGIN_URL, {
      headers: { "user-agent": this.#userAgent, referer: this.#referer },
    });
    if (loginPage.statusCode !== 200) {
      throw new Error(`카카오 로그인 페이지 요청 실패 (${loginPage.statusCode})`);
    }

    this.#referer = LOGIN_URL;
    this.#captureCookies(loginPage.headers);
    const $ = load(await loginPage.body.text());
    const nextData = $("#__NEXT_DATA__").text();
    let cryptoKey: string | undefined;
    if (nextData) {
      const parsed = JSON.parse(nextData) as {
        props?: { pageProps?: { pageContext?: { commonContext?: { p?: string } } } };
      };
      cryptoKey = parsed.props?.pageProps?.pageContext?.commonContext?.p;
    }
    cryptoKey ??= $("input[name=p]").attr("value");
    if (!cryptoKey) {
      throw new Error("카카오 로그인 암호화 키를 찾지 못했습니다. 로그인 화면 구조가 변경됐을 수 있습니다.");
    }

    const form = new FormData();
    form.set("os", "web");
    form.set("webview_v", "2");
    form.set("email", CryptoJS.AES.encrypt(email, cryptoKey).toString());
    form.set("password", CryptoJS.AES.encrypt(password, cryptoKey).toString());
    form.set("continue", decodeURIComponent(LOGIN_URL.split("continue=")[1]));
    form.set("third", "false");
    form.set("k", "true");

    const response = await request("https://accounts.kakao.com/weblogin/authenticate.json", {
      method: "POST",
      body: form,
      headers: {
        "user-agent": this.#userAgent,
        referer: this.#referer,
        cookie: this.#cookieHeader(),
      },
    });
    const responseText = await response.body.text();
    let status: number | undefined;
    try {
      status = (JSON.parse(responseText) as { status?: number }).status;
    } catch {
      throw new Error(`카카오 로그인 응답을 해석하지 못했습니다. HTTP ${response.statusCode}`);
    }
    if (status === -450) throw new Error("카카오 계정 이메일 또는 비밀번호가 올바르지 않습니다.");
    if (status === -481 || status === -484) {
      throw new Error("카카오 추가 인증이 필요합니다. 이 CLI는 추가 인증이나 CAPTCHA를 우회하지 않습니다.");
    }
    if (status !== 0) throw new Error(`카카오 로그인 실패 (status=${String(status)})`);
    this.#captureCookies(response.headers);
  }

  async listRooms(template: RoomTemplateRequest): Promise<RoomSummary[]> {
    this.#picker = await this.#openPicker(template);
    return this.#picker.rooms.map((room) => ({ ...room }));
  }

  async sendToRoom(roomId: string): Promise<void> {
    const picker = this.#picker;
    if (!picker) throw new Error("먼저 listRooms()로 채팅방 목록을 조회해야 합니다.");
    const room = picker.rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw new Error("선택한 채팅방이 현재 목록에 없습니다.");

    const response = await request(SEND_URL, {
      method: "POST",
      body: JSON.stringify({
        receiverChatRoomMemberCount: [room.memberCount ?? 1],
        receiverIds: [room.id],
        receiverType: "chat",
        securityKey: picker.securityKey,
        validatedTalkLink: picker.validatedTalkLink,
      }),
      headers: this.#pickerHeaders(picker.csrfToken, true),
    });
    const responseText = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`채팅방 전송 실패 (HTTP ${response.statusCode}): ${responseText.slice(0, 300)}`);
    }
  }

  async #openPicker(template: RoomTemplateRequest): Promise<PickerContext> {
    const form = new FormData();
    form.set("app_key", this.#javascriptKey);
    form.set("validation_action", "custom");
    form.set("validation_params", JSON.stringify(template));
    form.set("ka", this.#userAgent);
    form.set("lcba", "");
    const response = await request(PICKER_URL, {
      method: "POST",
      body: form,
      headers: {
        "user-agent": this.#userAgent,
        referer: this.#referer,
        cookie: this.#cookieHeader(),
      },
    });
    if (response.statusCode === 400) throw new Error("템플릿 또는 Web 플랫폼 도메인이 올바르지 않습니다.");
    if (response.statusCode === 401) throw new Error("KAKAO_JAVASCRIPT_KEY가 유효하지 않습니다.");
    if (response.statusCode !== 200) throw new Error(`공유 피커 요청 실패 (HTTP ${response.statusCode})`);

    this.#captureCookies(response.headers);
    const $ = load(await response.body.text());
    const validated = $("#validatedTalkLink").attr("value");
    const csrfToken = $("div").last().attr("ng-init")?.split("'")[1];
    if (!validated || !csrfToken) {
      throw new Error("공유 세션을 만들지 못했습니다. 로그인 세션 만료 또는 카카오 화면 변경 가능성이 있습니다.");
    }

    const chatsResponse = await request(CHATS_URL, { headers: this.#pickerHeaders(csrfToken) });
    if (chatsResponse.statusCode !== 200) throw new Error(`채팅방 목록 조회 실패 (HTTP ${chatsResponse.statusCode})`);
    const payload = (await chatsResponse.body.json()) as KakaoChatPayload;
    const rooms = normalizeRooms(payload.chats);
    if (typeof payload.securityKey !== "string") throw new Error("채팅방 응답에 securityKey가 없습니다.");

    let validatedTalkLink: unknown;
    try {
      validatedTalkLink = JSON.parse(validated);
    } catch {
      throw new Error("검증된 카카오링크 템플릿을 해석하지 못했습니다.");
    }
    return { csrfToken, securityKey: payload.securityKey, validatedTalkLink, rooms };
  }

  #pickerHeaders(csrfToken: string, json = false): Record<string, string> {
    return {
      "user-agent": this.#userAgent,
      referer: PICKER_URL,
      cookie: this.#cookieHeader(),
      "Csrf-Token": csrfToken,
      "App-Key": this.#javascriptKey,
      ...(json ? { "content-type": "application/json;charset=UTF-8" } : {}),
    };
  }

  #captureCookies(headers: Dispatcher.ResponseData["headers"]): void {
    const setCookie = (headers as Record<string, string | string[] | undefined>)["set-cookie"];
    const values = typeof setCookie === "string" ? [setCookie] : (setCookie ?? []);
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.#cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  #cookieHeader(): string {
    return [...this.#cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}
