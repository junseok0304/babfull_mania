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
  id: number;
  food_id: number;
  storage_path: string;
  source_url: string | null;
  source_document_url: string | null;
  source_name: string | null;
  license_note: string | null;
};

const IMAGE_MATCH_VERSION = 3;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "").trim();

const curatedImages: Record<string, SearchDocument> = {
  백미밥: {
    image_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Bowl_of_white_rice_01.jpg/960px-Bowl_of_white_rice_01.jpg",
    thumbnail_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Bowl_of_white_rice_01.jpg/320px-Bowl_of_white_rice_01.jpg",
    display_sitename: "Wikimedia Commons",
    doc_url: "https://commons.wikimedia.org/wiki/File:Bowl_of_white_rice_01.jpg",
    width: 960,
    height: 640,
  },
  열무김치: {
    image_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/61/Yeolmu-gimchi.jpg/960px-Yeolmu-gimchi.jpg",
    thumbnail_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/61/Yeolmu-gimchi.jpg/320px-Yeolmu-gimchi.jpg",
    display_sitename: "Wikimedia Commons",
    doc_url: "https://commons.wikimedia.org/wiki/File:Yeolmu-gimchi.jpg",
    width: 960,
    height: 720,
  },
  미역국: {
    image_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Miyeok-guk.jpg/960px-Miyeok-guk.jpg",
    thumbnail_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Miyeok-guk.jpg/320px-Miyeok-guk.jpg",
    display_sitename: "Wikimedia Commons",
    doc_url: "https://commons.wikimedia.org/wiki/File:Miyeok-guk.jpg",
    width: 960,
    height: 640,
  },
  석박지: {
    image_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/23/Kkakdugi.jpg/960px-Kkakdugi.jpg",
    thumbnail_url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/23/Kkakdugi.jpg/320px-Kkakdugi.jpg",
    display_sitename: "Wikimedia Commons",
    doc_url: "https://commons.wikimedia.org/wiki/File:Kkakdugi.jpg",
    width: 960,
    height: 640,
  },
  돈육청경채볶음: {
    image_url: "https://t1.daumcdn.net/cfile/tistory/99FC45375CEA9C7A39",
    thumbnail_url: "https://search2.kakaocdn.net/argon/130x130_85_c/4dyfDf5euFm",
    display_sitename: "티스토리",
    doc_url: "https://denis-yu.tistory.com/286",
    width: 403,
    height: 403,
  },
  간장양념장: {
    image_url: "https://postfiles.pstatic.net/20160112_73/hongr10_1452565437050bQaKx_JPEG/P1120370.JPG?type=w2",
    thumbnail_url: "https://search1.kakaocdn.net/argon/130x130_85_c/F3xNxYi48Gl",
    display_sitename: "네이버블로그",
    doc_url: "http://blog.naver.com/hongr10/220594974948",
    width: 743,
    height: 557,
  },
};

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
    const url = `${document.image_url || ""} ${document.doc_url || ""}`;
    const recipeBonus = /recipe1\.ezmember\.co\.kr|10000recipe/u.test(url) ? 70 : 0;
    const unreliablePenalty = /dthumb-phinf|keditor\/emoticon|coupang|shophow/u.test(url) ? 80 : 0;
    return { document, score: 100 - index * 4 + enoughPixels + cropFriendly + recipeBonus - sourcePenalty - unreliablePenalty };
  })
  .sort((a, b) => b.score - a.score)[0]?.document;

const searchImage = async (apiKey: string, foodName: string) => {
  if (curatedImages[foodName]) return curatedImages[foodName];
  const requestSearch = async (query: string) => {
    const url = new URL("https://dapi.kakao.com/v2/search/image");
    url.searchParams.set("query", query);
    url.searchParams.set("sort", "accuracy");
    url.searchParams.set("size", "12");
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`이미지 검색 서버 HTTP ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload?.documents) ? payload.documents : [];
  };
  const exact = pickImage(await requestSearch(`"${foodName}"`));
  if (exact) return exact;
  return pickImage(await requestSearch(`${foodName} 레시피 완성 사진`));
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
      .select("id, food_id, storage_path, source_url, source_document_url, source_name, license_note")
      .in("food_id", foodRows.map((food) => food.id)).eq("review_status", "approved")
      .order("created_at", { ascending: false });
    if (cacheError) throw cacheError;
    const imageByFoodId = new Map<number, ImageRow>();
    (cached ?? []).forEach((image: ImageRow) => { if (!imageByFoodId.has(image.food_id)) imageByFoodId.set(image.food_id, image); });

    const refreshFoods = foodRows.filter((food) => {
      const note = imageByFoodId.get(food.id)?.license_note || "";
      return !note.includes("admin-selected") && !note.includes(`babfull-image-v${IMAGE_MATCH_VERSION}`);
    });
    await mapConcurrent(refreshFoods, 5, async (food) => {
      try {
        const result = await searchImage(kakaoApiKey, food.original_name);
        if (!result?.thumbnail_url || !result.image_url) return;
        const values = {
          food_id: food.id,
          storage_path: result.thumbnail_url,
          source_url: result.image_url,
          source_document_url: result.doc_url || null,
          source_name: result.display_sitename || "카카오 이미지 검색",
          license_note: result.display_sitename === "Wikimedia Commons"
            ? `babfull-image-v${IMAGE_MATCH_VERSION} · Wikimedia Commons 원문 라이선스 적용`
            : `babfull-image-v${IMAGE_MATCH_VERSION} · 외부 이미지 검색 결과이며 원문 출처의 이용 조건을 확인해야 합니다.`,
          review_status: "approved",
          reviewed_at: new Date().toISOString(),
        };
        const previous = imageByFoodId.get(food.id);
        const query = previous ? db.from("food_images").update(values).eq("id", previous.id) : db.from("food_images").insert(values);
        const { data, error } = await query
          .select("id, food_id, storage_path, source_url, source_document_url, source_name, license_note").single();
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
