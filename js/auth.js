import { getSupabaseClient } from "./supabase-client.js";

/**
 * Supabase Auth와 카카오 OAuth 사이의 최소 인증 어댑터입니다.
 * 카카오 provider token은 공유 기능에 필요할 때만 현재 탭의 sessionStorage에 보관하며 영구 저장하지 않습니다.
 */
const KAKAO_PROVIDER_TOKEN_KEY = "babfull:kakao-provider-token";

const rememberProviderToken = (session) => {
  if (session?.provider_token) {
    sessionStorage.setItem(KAKAO_PROVIDER_TOKEN_KEY, session.provider_token);
  }
};

export const getKakaoProviderToken = (session) => {
  rememberProviderToken(session);
  return session?.provider_token || sessionStorage.getItem(KAKAO_PROVIDER_TOKEN_KEY);
};

export const clearKakaoProviderToken = () => {
  sessionStorage.removeItem(KAKAO_PROVIDER_TOKEN_KEY);
};

export const getAuthState = async () => {
  const client = await getSupabaseClient();
  if (!client) return { available: false, session: null, client: null };
  const { data, error } = await client.auth.getSession();
  rememberProviderToken(data.session);
  return { available: true, session: data.session, client, error };
};

export const signInWithKakao = async ({ returnRoute = "mypage", scopes } = {}) => {
  // 인증 완료 뒤 원래 화면으로 돌아오기 위해 내부 라우트만 세션에 기억합니다.
  const client = await getSupabaseClient();
  if (!client) throw new Error("Supabase 설정이 필요합니다.");
  sessionStorage.setItem("babfull:post-auth-route", returnRoute);
  const { error } = await client.auth.signInWithOAuth({
    provider: "kakao",
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
      ...(scopes ? { scopes } : {}),
    },
  });
  if (error) {
    sessionStorage.removeItem("babfull:post-auth-route");
    throw error;
  }
};

export const signOut = async () => {
  const client = await getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
  sessionStorage.removeItem(KAKAO_PROVIDER_TOKEN_KEY);
};

export const loadMyPageData = async (userId) => {
  const client = await getSupabaseClient();
  if (!client) return null;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [profileResult, usageResult] = await Promise.all([
    client.from("profiles").select("id, name, affiliation, profile_image_url, auth_provider, qr_token, is_active").eq("id", userId).single(),
    client.from("meal_usages").select("id, meal_date, meal_type, price, status, created_at").eq("user_id", userId).gte("meal_date", monthStart.toISOString().slice(0, 10)).order("created_at", { ascending: false }),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (usageResult.error) throw usageResult.error;
  return { profile: profileResult.data, usages: usageResult.data ?? [] };
};
