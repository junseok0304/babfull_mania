/**
 * 브라우저에서 사용할 공개 Supabase 설정만 읽어 단일 클라이언스를 생성합니다.
 * service role key 같은 서버 비밀값은 이 모듈이 받거나 반환하지 않습니다.
 */
let clientPromise;

const loadLocalConfig = async () => {
  const configUrls = ["/js/config.local.json", "/api/config"];

  for (const url of configUrls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const config = await response.json();
      if (config.supabaseUrl && config.supabaseAnonKey) return config;
    } catch {
      // 로컬 정적 서버에는 /api/config가 없을 수 있으므로 다음 후보를 확인한다.
    }
  }

  return null;
};

export const getSupabaseClient = async () => {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = await loadLocalConfig();
      if (!config) return null;
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    })();
  }
  return clientPromise;
};
