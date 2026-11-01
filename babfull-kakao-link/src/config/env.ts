import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(process.cwd(), ".env") });
loadDotenv({ path: resolve(process.cwd(), "../.env") });

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`필수 환경변수가 없습니다: ${name}`);
  return value;
}

export interface KakaoConfig {
  restApiKey: string;
  clientSecret?: string;
  redirectUri: string;
  templateId: number;
}

export interface KakaoRoomConfig {
  javascriptKey: string;
  shareDomain: string;
  accountEmail: string;
  accountPassword: string;
}

export function getKakaoConfig(): KakaoConfig {
  const templateId = Number(optional("KAKAO_TEMPLATE_ID") ?? "138483");
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error("KAKAO_TEMPLATE_ID는 양의 정수여야 합니다.");
  }

  return {
    restApiKey: required("KAKAO_REST_API_KEY"),
    clientSecret: optional("KAKAO_LOGIN_CLIENT_SECRET"),
    redirectUri:
      optional("KAKAO_REDIRECT_URI") ?? "http://127.0.0.1:4399/oauth/callback",
    templateId,
  };
}

export function getKakaoRoomConfig(): KakaoRoomConfig {
  return {
    javascriptKey: required("KAKAO_JAVASCRIPT_KEY"),
    shareDomain: optional("KAKAO_SHARE_DOMAIN") ?? "https://babfullmania.vercel.app",
    accountEmail: required("KAKAO_ACCOUNT_EMAIL"),
    accountPassword: required("KAKAO_ACCOUNT_PASSWORD"),
  };
}
