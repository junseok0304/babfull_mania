import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * 관리자의 메뉴 대표 사진 검색·선택·크롭 설정을 처리합니다.
 * 검색 후보는 서명된 단기 토큰으로 다시 검증해 클라이언트가 임의 이미지 URL을 저장하지 못하게 합니다.
 */
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
  provider: "Kakao" | "Google";
};

type CandidateTokenPayload = ImageCandidate & {
  foodId: number;
  expiresAt: number;
};

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "").trim();
const isHttpsImage = (value?: string) => Boolean(value?.startsWith("https://") && !/\.gif(?:$|\?)/i.test(value));
const clampNumber = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
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
  // 후보 URL과 만료 시각에 HMAC 서명을 붙여 검색 결과가 저장 요청 사이에 바뀌지 않게 합니다.
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

const searchKakao = async (apiKey: string, query: string, page = 1) => {
  const url = new URL("https://dapi.kakao.com/v2/search/image");
  url.searchParams.set("query", query);
  url.searchParams.set("sort", "accuracy");
  url.searchParams.set("size", "24");
  url.searchParams.set("page", String(page));
  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`이미지 검색 서버 HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.documents) ? payload.documents as SearchDocument[] : [];
};

const searchGoogle = async (apiKey: string, searchEngineId: string, foodName: string, page = 1): Promise<ImageCandidate[]> => {
  const url = new URL("https://customsearch.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", searchEngineId);
  url.searchParams.set("q", `${foodName} 요리 완성 사진`);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("imgType", "photo");
  url.searchParams.set("safe", "active");
  url.searchParams.set("num", "8");
  url.searchParams.set("start", String(Math.min(91, 1 + (page - 1) * 8)));
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Google 이미지 검색 HTTP ${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload?.items) ? payload.items : []).map((item: Record<string, unknown>) => {
    const image = (item.image || {}) as Record<string, unknown>;
    return {
      imageUrl: String(item.link || ""),
      fallbackUrl: String(image.thumbnailLink || item.link || ""),
      documentUrl: String(image.contextLink || "") || null,
      sourceName: String(item.displayLink || "Google 이미지"),
      width: Number(image.width) || null,
      height: Number(image.height) || null,
      provider: "Google" as const,
    };
  }).filter((candidate: ImageCandidate) => isHttpsImage(candidate.imageUrl) && isHttpsImage(candidate.fallbackUrl));
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

const findCandidates = async (
  apiKey: string,
  foodName: string,
  currentUrl?: string | null,
  googleApiKey?: string,
  googleSearchEngineId?: string,
  searchPage = 1,
) => {
  const [exact, descriptive] = await Promise.all([
    searchKakao(apiKey, `"${foodName}"`, searchPage),
    searchKakao(apiKey, `${foodName} 요리 완성 사진`, searchPage),
  ]);
  const seen = new Set<string>();
  const kakaoCandidates = [...exact, ...descriptive]
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
      provider: "Kakao" as const,
    }));
  let googleCandidates: ImageCandidate[] = [];
  if (googleApiKey && googleSearchEngineId) {
    try {
      googleCandidates = await searchGoogle(googleApiKey, googleSearchEngineId, foodName, searchPage);
    } catch (error) {
      console.warn("Google 이미지 후보 조회 실패", error);
    }
  }
  const merged = googleCandidates.length
    ? [...googleCandidates.slice(0, 4), ...kakaoCandidates]
    : kakaoCandidates;
  const urls = new Set<string>();
  return merged.filter((candidate) => candidate.imageUrl !== currentUrl && !urls.has(candidate.imageUrl) && urls.add(candidate.imageUrl)).slice(0, 12);
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const kakaoApiKey = Deno.env.get("KAKAO_REST_API_KEY");
    const googleApiKey = Deno.env.get("GOOGLE_SEARCH_API_KEY");
    const googleSearchEngineId = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
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
    const searchPage = Math.round(clampNumber(body?.searchPage, 1, 10, 1));
    if (!foodName || foodName.length > 100) return Response.json({ error: "메뉴명을 확인해주세요." }, { status: 400, headers: corsHeaders });

    let { data: food, error: foodError } = await db.from("foods")
      .select("id, original_name, normalized_name").eq("normalized_name", normalize(foodName)).maybeSingle();
    if (foodError) throw foodError;
    if (!food) {
      const result = await db.from("foods")
        .upsert({ original_name: foodName, normalized_name: normalize(foodName) }, { onConflict: "normalized_name" })
        .select("id, original_name, normalized_name").single();
      if (result.error || !result.data) throw result.error || new Error("메뉴를 사진 관리 목록에 등록하지 못했습니다.");
      food = result.data;
    }
    await db.from("meal_items").update({ food_id: food.id }).is("food_id", null).eq("original_menu_text", foodName);

    const { data: current } = await db.from("food_images")
      .select("id, storage_path, source_url, source_document_url, source_name, crop_zoom, focal_x, focal_y")
      .eq("food_id", food.id).eq("review_status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (action === "candidates") {
      const candidates = await findCandidates(kakaoApiKey, food.original_name, current?.source_url, googleApiKey, googleSearchEngineId, searchPage);
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
          cropZoom: Number(current.crop_zoom) || 1.08,
          focalX: current.focal_x == null ? 50 : Number(current.focal_x),
          focalY: current.focal_y == null ? 50 : Number(current.focal_y),
          provider: "Kakao",
          selectionToken: await createCandidateToken(serviceRoleKey, food.id, {
            imageUrl: current.source_url || current.storage_path,
            fallbackUrl: current.storage_path || current.source_url,
            documentUrl: current.source_document_url,
            sourceName: current.source_name || "기존 대표 사진",
            width: null,
            height: null,
            provider: "Kakao",
          }),
        } : null,
        candidates: signedCandidates,
        providers: { kakao: true, google: Boolean(googleApiKey && googleSearchEngineId) },
        searchPage,
      }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
    }

    if (action !== "select") return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 400, headers: corsHeaders });
    const selectionToken = String(body?.selectionToken || "");
    if (!selectionToken) return Response.json({ error: "사진 후보가 만료되었습니다. 다시 검색해주세요." }, { status: 400, headers: corsHeaders });
    const selected = await verifyCandidateToken(serviceRoleKey, selectionToken, food.id);
    const cropZoom = clampNumber(body?.cropZoom, 1, 2.5, 1.08);
    const focalX = Math.round(clampNumber(body?.focalX, -50, 150, 50));
    const focalY = Math.round(clampNumber(body?.focalY, -50, 150, 50));

    const values = {
      food_id: food.id,
      storage_path: selected.fallbackUrl,
      source_url: selected.imageUrl,
      source_document_url: selected.documentUrl,
      source_name: selected.sourceName,
      crop_zoom: cropZoom,
      focal_x: focalX,
      focal_y: focalY,
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
