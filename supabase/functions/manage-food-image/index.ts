import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SearchDocument = {
  thumbnail_url?: string;
  image_url?: string;
  width?: number;
  height?: number;
  display_sitename?: string;
  doc_url?: string;
};

type ImageCandidate = {
  imageUrl: string;
  fallbackUrl: string;
  documentUrl: string | null;
  sourceName: string;
  width: number | null;
  height: number | null;
};

type CandidateTokenPayload = ImageCandidate & {
  foodId: number;
  expiresAt: number;
};

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "").trim();
const isHttpsImage = (value?: string) => Boolean(value?.startsWith("https://") && !/\.gif(?:$|\?)/i.test(value));
const textEncoder = new TextEncoder();

const toBase64Url = (value: Uint8Array) => {
  let binary = "";
  value.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const importSigningKey = (secret: string) => crypto.subtle.importKey(
  "raw",
  textEncoder.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

const createCandidateToken = async (secret: string, foodId: number, candidate: ImageCandidate) => {
  const payload: CandidateTokenPayload = { ...candidate, foodId, expiresAt: Date.now() + 15 * 60 * 1000 };
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
};

const verifyCandidateToken = async (secret: string, token: string, foodId: number) => {
  const [encodedPayload, encodedSignature, ...extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra.length) throw new Error("사진 후보 정보가 올바르지 않습니다. 다시 검색해주세요.");
  const key = await importSigningKey(secret);
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(encodedSignature),
    textEncoder.encode(encodedPayload),
  );
  if (!verified) throw new Error("사진 후보 정보가 변경되었습니다. 다시 검색해주세요.");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as CandidateTokenPayload;
  if (payload.foodId !== foodId || payload.expiresAt < Date.now()) throw new Error("사진 후보가 만료되었습니다. 다시 검색해주세요.");
  if (!isHttpsImage(payload.imageUrl) || !isHttpsImage(payload.fallbackUrl)) throw new Error("사용할 수 없는 사진 주소입니다.");
  return payload;
};

const searchKakao = async (apiKey: string, query: string) => {
  const url = new URL("https://dapi.kakao.com/v2/search/image");
  url.searchParams.set("query", query);
  url.searchParams.set("sort", "accuracy");
  url.searchParams.set("size", "24");
  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`이미지 검색 서버 HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.documents) ? payload.documents as SearchDocument[] : [];
};

const candidateScore = (document: SearchDocument, index: number) => {
  const width = Number(document.width) || 0;
  const height = Number(document.height) || 0;
  const ratio = height ? width / height : 0;
  const resolution = width >= 600 && height >= 400 ? 35 : width >= 350 && height >= 240 ? 20 : 0;
  const crop = ratio >= 0.7 && ratio <= 1.8 ? 25 : ratio >= 0.5 && ratio <= 2.2 ? 10 : 0;
  const value = `${document.image_url || ""} ${document.doc_url || ""}`;
  const recipe = /recipe1\.ezmember\.co\.kr|10000recipe/u.test(value) ? 45 : 0;
  const unreliable = /dthumb-phinf|keditor\/emoticon|coupang|shophow/u.test(value) ? 100 : 0;
  const commerce = /쇼핑|마켓|스토어|쿠팡|옥션|지마켓/u.test(document.display_sitename || "") ? 40 : 0;
  return 150 - index * 3 + resolution + crop + recipe - unreliable - commerce;
};

const findCandidates = async (apiKey: string, foodName: string, currentUrl?: string | null) => {
  const [exact, descriptive] = await Promise.all([
    searchKakao(apiKey, `"${foodName}"`),
    searchKakao(apiKey, `${foodName} 요리 완성 사진`),
  ]);
  const seen = new Set<string>();
  return [...exact, ...descriptive]
    .filter((document) => isHttpsImage(document.image_url) && isHttpsImage(document.thumbnail_url))
    .filter((document) => document.image_url !== currentUrl && !seen.has(document.image_url!) && seen.add(document.image_url!))
    .map((document, index) => ({ document, score: candidateScore(document, index) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ document }) => ({
      imageUrl: document.image_url,
      fallbackUrl: document.thumbnail_url,
      documentUrl: document.doc_url || null,
      sourceName: document.display_sitename || "이미지 검색",
      width: Number(document.width) || null,
      height: Number(document.height) || null,
    }));
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const kakaoApiKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !kakaoApiKey) throw new Error("사진 관리 서버 환경변수가 설정되지 않았습니다.");

    const authorization = request.headers.get("Authorization") || "";
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers: corsHeaders });

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: profile } = await db.from("profiles").select("role, is_active").eq("id", userData.user.id).single();
    if (profile?.role !== "admin" || !profile?.is_active) {
      return Response.json({ error: "관리자만 메뉴 사진을 변경할 수 있습니다." }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const action = String(body?.action || "candidates");
    const foodName = String(body?.foodName || "").trim();
    if (!foodName || foodName.length > 100) return Response.json({ error: "메뉴명을 확인해주세요." }, { status: 400, headers: corsHeaders });

    const { data: food, error: foodError } = await db.from("foods")
      .select("id, original_name, normalized_name").eq("normalized_name", normalize(foodName)).single();
    if (foodError || !food) return Response.json({ error: "등록된 메뉴를 찾지 못했습니다." }, { status: 404, headers: corsHeaders });

    const { data: current } = await db.from("food_images")
      .select("id, storage_path, source_url, source_document_url, source_name")
      .eq("food_id", food.id).eq("review_status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (action === "candidates") {
      const candidates = await findCandidates(kakaoApiKey, food.original_name, current?.source_url);
      const signedCandidates = await Promise.all(candidates.map(async (candidate) => ({
        ...candidate,
        selectionToken: await createCandidateToken(serviceRoleKey, food.id, candidate as ImageCandidate),
      })));
      return Response.json({
        food: { id: food.id, name: food.original_name },
        current: current ? {
          imageUrl: current.source_url || current.storage_path,
          fallbackUrl: current.storage_path,
          documentUrl: current.source_document_url,
          sourceName: current.source_name,
        } : null,
        candidates: signedCandidates,
      }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
    }

    if (action !== "select") return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 400, headers: corsHeaders });
    const selectionToken = String(body?.selectionToken || "");
    if (!selectionToken) return Response.json({ error: "사진 후보가 만료되었습니다. 다시 검색해주세요." }, { status: 400, headers: corsHeaders });
    const selected = await verifyCandidateToken(serviceRoleKey, selectionToken, food.id);

    const values = {
      food_id: food.id,
      storage_path: selected.fallbackUrl,
      source_url: selected.imageUrl,
      source_document_url: selected.documentUrl,
      source_name: selected.sourceName,
      license_note: "admin-selected · 관리자가 이미지 검색 후보에서 선택한 대표 사진입니다.",
      review_status: "approved",
      reviewed_by: userData.user.id,
      reviewed_at: new Date().toISOString(),
    };
    const query = current
      ? db.from("food_images").update(values).eq("id", current.id)
      : db.from("food_images").insert(values);
    const { error: saveError } = await query;
    if (saveError) throw saveError;

    return Response.json({ ok: true, foodName: food.original_name, selected }, { headers: corsHeaders });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "메뉴 사진을 관리하지 못했습니다." },
      { status: 500, headers: corsHeaders },
    );
  }
});
