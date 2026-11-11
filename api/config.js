// 프론트엔드에 공개 가능한 Supabase URL과 anon key만 전달합니다. 서버 비밀키는 절대 응답하지 않습니다.
module.exports = function handler(_request, response) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (!supabaseUrl || !supabaseAnonKey) {
    return response.status(503).json({
      error: "Supabase public configuration is not available.",
    });
  }

  return response.status(200).json({ supabaseUrl, supabaseAnonKey });
};
