let clientPromise;

const loadLocalConfig = async () => {
  try {
    const response = await fetch("./js/config.local.json", { cache: "no-store" });
    if (!response.ok) return null;
    const config = await response.json();
    if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
    return config;
  } catch {
    return null;
  }
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
