import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseYeongjunMenu } from "../_shared/yeongjun-parser.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const allowedSource = "https://yeongjun.com/babfullmenu";

const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

const currentSeoulMonday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

const requireCaller = async (request: Request, db: any, trigger: string) => {
  if (trigger === "cron") {
    const expected = Deno.env.get("CRON_SECRET");
    if (!expected || request.headers.get("x-cron-secret") !== expected) throw new Error("유효하지 않은 Cron 요청입니다.");
    return;
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("관리자 로그인이 필요합니다.");
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) throw new Error("로그인 세션을 확인할 수 없습니다.");
  const { data: profile } = await db.from("profiles").select("role, is_active").eq("id", userData.user.id).single();
  const adminProfile = profile as { role?: string; is_active?: boolean } | null;
  if (!adminProfile?.is_active || adminProfile.role !== "admin") throw new Error("관리자 권한이 필요합니다.");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Supabase 서버 환경변수가 없습니다." }, 500);
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let logId: number | null = null;
  try {
    const payload = await request.json().catch(() => ({}));
    const trigger = payload?.trigger === "cron" ? "cron" : "manual";
    await requireCaller(request, db, trigger);

    const sourceUrl = Deno.env.get("BABFULL_MENU_URL") || allowedSource;
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "yeongjun.com" || parsedUrl.pathname !== "/babfullmenu") {
      throw new Error("허용되지 않은 식단 원본 주소입니다.");
    }
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: running } = await db.from("meal_import_logs").select("id").eq("status", "running").gte("started_at", tenMinutesAgo).limit(1);
    if (running?.length) return jsonResponse({ error: "이미 식단 최신화가 진행 중입니다." }, 409);

    const { data: log, error: logError } = await db.from("meal_import_logs")
      .insert({ source_url: sourceUrl, trigger_type: trigger, status: "running" }).select("id").single();
    if (logError) throw logError;
    logId = log.id;

    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BabfullMania/1.0)" },
      signal: AbortSignal.timeout(20000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error(`영준닷컴 HTTP ${response.status}`);
    if (!contentType.includes("text/html")) throw new Error(`예상하지 못한 콘텐츠 형식입니다: ${contentType}`);
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error("식단 페이지가 허용 크기를 초과했습니다.");
    const parsed = parseYeongjunMenu(html);
    if (parsed.dates[0] !== currentSeoulMonday()) {
      throw new Error(`영준닷컴 식단이 이번 주 기준으로 갱신되지 않았습니다: ${parsed.dates[0]}`);
    }

    const { data: result, error: importError } = await db.rpc("import_yeongjun_meals", {
      import_log_id: logId,
      target_source_url: sourceUrl,
      meal_payload: parsed.meals,
    });
    if (importError) throw importError;
    return jsonResponse({ ok: true, period: { from: parsed.dates[0], to: parsed.dates.at(-1) }, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "식단 최신화에 실패했습니다.";
    if (logId) await db.from("meal_import_logs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: message.slice(0, 1000) }).eq("id", logId);
    const unauthorized = /로그인|권한|Cron/.test(message);
    return jsonResponse({ error: message }, unauthorized ? 403 : 500);
  }
});
