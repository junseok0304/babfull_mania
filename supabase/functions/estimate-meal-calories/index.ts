import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NutritionRow = Record<string, string | null>;

const normalize = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase("ko-KR")
  .replace(/\([^)]*\)|\[[^\]]*\]|\*+/g, "")
  .replace(/\s+/g, "")
  .trim();

const queryName = (value: string) => value
  .replace(/\([^)]*\)|\[[^\]]*\]|\*+/g, "")
  .replace(/^(수제|직접만든|오늘의)\s*/u, "")
  .trim();

const numberFrom = (value: unknown) => {
  const match = String(value ?? "").replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const relatedFoodName = (foods: unknown) => {
  if (Array.isArray(foods)) return foods[0]?.original_name;
  return (foods as { original_name?: string } | null)?.original_name;
};

const getRows = (payload: Record<string, unknown>): NutritionRow[] => {
  const response = payload?.response as Record<string, unknown> | undefined;
  const body = (payload?.body || response?.body) as Record<string, unknown> | undefined;
  const items = body?.items as { item?: NutritionRow | NutritionRow[] } | NutritionRow[] | undefined;
  if (Array.isArray(items)) return items;
  const item = items?.item;
  if (Array.isArray(item)) return item;
  return item ? [item] : [];
};

const pickBest = (menuName: string, rows: NutritionRow[]) => {
  const wanted = normalize(menuName);
  return rows
    .map((row) => {
      const candidate = normalize(row.FOOD_NM_KR || "");
      const score = candidate === wanted ? 100 : candidate.includes(wanted) || wanted.includes(candidate) ? 60 : 0;
      return { row, score };
    })
    .filter(({ row, score }) => score && numberFrom(row.AMT_NUM1) !== null)
    .sort((a, b) => b.score - a.score || String(b.row.UPDATE_DATE || "").localeCompare(String(a.row.UPDATE_DATE || "")))[0]?.row;
};

const fetchDataGoNutrition = async (serviceKey: string, menuName: string) => {
  const url = new URL("https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "20");
  url.searchParams.set("type", "json");
  url.searchParams.set("FOOD_NM_KR", queryName(menuName));

  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`MFDS HTTP ${response.status}`);
  const payload = await response.json();
  const resultCode = String(payload?.header?.resultCode ?? payload?.body?.header?.resultCode ?? payload?.response?.header?.resultCode ?? "00");
  if (resultCode !== "00" && resultCode !== "0") throw new Error(`MFDS ${resultCode}`);
  return pickBest(menuName, getRows(payload));
};

const fetchFoodSafetyNutrition = async (serviceKey: string, menuName: string) => {
  const filter = `FOOD_NM_KR=${encodeURIComponent(queryName(menuName))}`;
  const url = `https://openapi.foodsafetykorea.go.kr/api/${serviceKey}/I2791/json/1/20/${filter}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`FoodSafetyKorea HTTP ${response.status}`);
  const payload = await response.json();
  const service = payload?.I2791;
  const resultCode = String(service?.RESULT?.CODE ?? "");
  if (!resultCode.startsWith("INFO")) throw new Error(`FoodSafetyKorea ${resultCode || "INVALID_RESPONSE"}`);
  return pickBest(menuName, Array.isArray(service?.row) ? service.row : []);
};

const fetchNutrition = async (foodSafetyKey: string | undefined, dataGoKey: string | undefined, menuName: string) => {
  if (foodSafetyKey) {
    try {
      const row = await fetchFoodSafetyNutrition(foodSafetyKey, menuName);
      if (row) return row;
    } catch (error) {
      console.warn("식품안전나라 I2791 조회 실패, 대체 API를 확인합니다.", error);
    }
  }
  if (dataGoKey) return fetchDataGoNutrition(dataGoKey, menuName);
  throw new Error("사용 가능한 식약처 영양정보 API가 없습니다.");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const foodSafetyKey = Deno.env.get("FOODSAFETYKOREA_API_KEY");
    const dataGoKey = Deno.env.get("DATA_GO_KR_SERVICE_KEY");
    if (!supabaseUrl || !serviceRoleKey || (!foodSafetyKey && !dataGoKey)) throw new Error("서버 환경변수가 설정되지 않았습니다.");

    const body = await request.json();
    const mealIds = [...new Set((body?.mealIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 10);
    if (!mealIds.length) return Response.json({ estimates: [] }, { headers: corsHeaders });

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: meals, error: mealsError } = await db
      .from("meals")
      .select("id, meal_items(original_menu_text, serving_grams, foods(original_name))")
      .in("id", mealIds)
      .eq("is_published", true)
      .eq("is_operating", true);
    if (mealsError) throw mealsError;

    const menuNames = [...new Set((meals ?? []).flatMap((meal) => meal.meal_items ?? [])
      .map((item) => item.original_menu_text || relatedFoodName(item.foods))
      .filter(Boolean))];
    const normalizedQueries = menuNames.map(normalize);
    const { data: cachedRows, error: cacheError } = await db
      .from("food_nutrition_cache")
      .select("*")
      .in("normalized_query", normalizedQueries);
    if (cacheError) throw cacheError;

    const nutritionByQuery = new Map((cachedRows ?? []).map((row) => [row.normalized_query, row]));
    for (const name of menuNames) {
      const key = normalize(name);
      const cached = nutritionByQuery.get(key);
      const cacheLifetime = cached?.match_status === "matched" ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60;
      if (cached && new Date(cached.fetched_at).getTime() > Date.now() - cacheLifetime) continue;

      try {
        const row = await fetchNutrition(foodSafetyKey, dataGoKey, name);
        const cacheRow = row ? {
          normalized_query: key,
          mfds_food_code: row.FOOD_CD,
          matched_name: row.FOOD_NM_KR,
          serving_amount: numberFrom(row.SERVING_SIZE),
          serving_unit: String(row.SERVING_SIZE || ""),
          calories_per_serving: numberFrom(row.AMT_NUM1),
          match_status: "matched",
          raw_data: row,
          fetched_at: new Date().toISOString(),
        } : {
          normalized_query: key,
          match_status: "no_match",
          fetched_at: new Date().toISOString(),
        };
        await db.from("food_nutrition_cache").upsert(cacheRow as any);
        nutritionByQuery.set(key, cacheRow);
      } catch (error) {
        console.warn(`영양정보 조회 실패: ${name}`, error);
        const cacheRow = { normalized_query: key, match_status: "error", fetched_at: new Date().toISOString() };
        await db.from("food_nutrition_cache").upsert(cacheRow);
        nutritionByQuery.set(key, cacheRow);
      }
    }

    const estimates = (meals ?? []).map((meal) => {
      const items = (meal.meal_items ?? []).map((item) => {
        const name = item.original_menu_text || relatedFoodName(item.foods);
        const nutrition = nutritionByQuery.get(normalize(name || ""));
        if (!nutrition || nutrition.match_status !== "matched") return { name, matched: false };
        const standardCalories = Number(nutrition.calories_per_serving);
        const standardAmount = Number(nutrition.serving_amount);
        const servingGrams = Number(item.serving_grams);
        const calories = servingGrams > 0 && standardAmount > 0
          ? standardCalories * servingGrams / standardAmount
          : standardCalories;
        return { name, matched: true, calories: Math.round(calories), servingGrams: servingGrams || standardAmount || null };
      });
      const matched = items.filter((item) => item.matched);
      return {
        mealId: meal.id,
        totalCalories: matched.reduce((sum, item) => sum + (item.calories || 0), 0),
        matchedItems: matched.length,
        totalItems: items.length,
        source: "mfds",
        items,
      };
    });

    return Response.json({ estimates }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "영양정보를 계산하지 못했습니다." }, { status: 500, headers: corsHeaders });
  }
});
