import { getSupabaseClient } from "./supabase-client.js";

export const getAuthState = async () => {
  const client = await getSupabaseClient();
  if (!client) return { available: false, session: null, client: null };
  const { data, error } = await client.auth.getSession();
  return { available: true, session: data.session, client, error };
};

export const signInWithKakao = async () => {
  const client = await getSupabaseClient();
  if (!client) throw new Error("Supabase 설정이 필요합니다.");
  const { error } = await client.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: `${window.location.origin}${window.location.pathname}#mypage` },
  });
  if (error) throw error;
};

export const signOut = async () => {
  const client = await getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
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
