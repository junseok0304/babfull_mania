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
