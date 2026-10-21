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

type FoodRow = { id: number; original_name: string; normalized_name: string };
type ImageRow = {
  food_id: number;
  storage_path: string;
  source_url: string | null;
  source_document_url: string | null;
  source_name: string | null;
};

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "").trim();

const mapConcurrent = async <T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>) => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await work(values[index]);
    }
  }));
  return results;
};

const isHttpsImage = (value?: string) => Boolean(value?.startsWith("https://") && !/\.gif(?:$|\?)/i.test(value));

const pickImage = (documents: SearchDocument[]) => documents
  .filter((document) => isHttpsImage(document.image_url) && isHttpsImage(document.thumbnail_url))
  .map((document, index) => {
    const width = Number(document.width) || 0;
    const height = Number(document.height) || 0;
    const ratio = height ? width / height : 0;
    const enoughPixels = width >= 400 && height >= 260 ? 30 : width >= 250 && height >= 180 ? 15 : 0;
    const cropFriendly = ratio >= 0.7 && ratio <= 1.8 ? 20 : ratio >= 0.5 && ratio <= 2.2 ? 8 : 0;
    const sourcePenalty = /쇼핑|마켓|스토어|쿠팡|옥션|지마켓/u.test(document.display_sitename || "") ? 20 : 0;
    return { document, score: 100 - index * 4 + enoughPixels + cropFriendly - sourcePenalty };
  })
  .sort((a, b) => b.score - a.score)[0]?.document;

const searchImage = async (apiKey: string, foodName: string) => {
  const url = new URL("https://dapi.kakao.com/v2/search/image");
  url.searchParams.set("query", `${foodName} 음식 요리`);
  url.searchParams.set("sort", "accuracy");
  url.searchParams.set("size", "12");
  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`이미지 검색 서버 HTTP ${response.status}`);
  const payload = await response.json();
  return pickImage(Array.isArray(payload?.documents) ? payload.documents : []);
};

const toResponseImage = (food: FoodRow, image?: ImageRow | null) => ({
  name: food.original_name,
  normalizedName: food.normalized_name,
  imageUrl: image?.source_url || image?.storage_path || null,
  fallbackUrl: image?.storage_path || image?.source_url || null,
  documentUrl: image?.source_document_url || null,
  sourceName: image?.source_name || null,
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const kakaoApiKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!supabaseUrl || !serviceRoleKey || !kakaoApiKey) throw new Error("이미지 검색 서버 환경변수가 설정되지 않았습니다.");

    const body = await request.json();
    const requestedNames = [...new Set((body?.foodNames ?? [])
      .map((name: unknown) => String(name ?? "").trim())
      .filter((name: string) => name && name.length <= 100))].slice(0, 30) as string[];
    if (!requestedNames.length) return Response.json({ images: [] }, { headers: corsHeaders });

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const normalizedNames = requestedNames.map(normalize);
    const { data: foods, error: foodsError } = await db.from("foods")
      .select("id, original_name, normalized_name").in("normalized_name", normalizedNames);
    if (foodsError) throw foodsError;
    const foodRows = (foods ?? []) as FoodRow[];
    if (!foodRows.length) return Response.json({ images: [] }, { headers: corsHeaders });

    const { data: cached, error: cacheError } = await db.from("food_images")
      .select("food_id, storage_path, source_url, source_document_url, source_name")
      .in("food_id", foodRows.map((food) => food.id)).eq("review_status", "approved")
      .order("created_at", { ascending: false });
    if (cacheError) throw cacheError;
    const imageByFoodId = new Map<number, ImageRow>();
    (cached ?? []).forEach((image: ImageRow) => { if (!imageByFoodId.has(image.food_id)) imageByFoodId.set(image.food_id, image); });

    const missingFoods = foodRows.filter((food) => !imageByFoodId.has(food.id));
    await mapConcurrent(missingFoods, 5, async (food) => {
      try {
        const result = await searchImage(kakaoApiKey, food.original_name);
        if (!result?.thumbnail_url || !result.image_url) return;
        const values = {
          food_id: food.id,
          storage_path: result.thumbnail_url,
          source_url: result.image_url,
          source_document_url: result.doc_url || null,
          source_name: result.display_sitename || "카카오 이미지 검색",
          license_note: "외부 이미지 검색 결과입니다. 원문 출처의 이용 조건을 확인해야 합니다.",
          review_status: "approved",
          reviewed_at: new Date().toISOString(),
        };
        const { data, error } = await db.from("food_images").insert(values)
          .select("food_id, storage_path, source_url, source_document_url, source_name").single();
        if (error) throw error;
        imageByFoodId.set(food.id, data as ImageRow);
      } catch (error) {
        console.warn(`음식 이미지 조회 실패: ${food.original_name}`, error);
      }
    });

    const foodByNormalized = new Map(foodRows.map((food) => [food.normalized_name, food]));
    const images = requestedNames.map((name) => foodByNormalized.get(normalize(name)))
      .filter((food): food is FoodRow => Boolean(food))
      .map((food) => toResponseImage(food, imageByFoodId.get(food.id)));
    return Response.json({ images }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=86400" } });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "음식 이미지를 불러오지 못했습니다." },
      { status: 500, headers: corsHeaders },
    );
  }
});
