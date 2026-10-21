import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NutritionRow = Record<string, string | null>;
type MealItem = { id: number; original_menu_text: string; serving_grams: number | null; foods?: { original_name?: string } | Array<{ original_name?: string }> | null };
const MATCH_VERSION = 3;

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR")
  .replace(/\([^)]*\)|\[[^\]]*\]|\*+/g, "").replace(/\s+/g, "")
  .replaceAll("까스", "가스").replaceAll("육계장", "육개장").replaceAll("집곡밥", "잡곡밥").trim();

const queryName = (value: string) => value.replace(/\([^)]*\)|\[[^\]]*\]|\*+/g, "")
  .replace(/^(수제|직접만든|오늘의)\s*/u, "").replaceAll("육계장", "육개장").replaceAll("집곡밥", "잡곡밥").trim();

const splitMenuNames = (value: string) => value
  .replace(/\s+(?=(?:도시락김|유부초밥|깍두기|배추김치|석박지|무생채|계란후라이|삶은계란)$)/u, "/")
  .split(/\s*(?:\/|&)\s*/u)
  .map((name) => name.trim())
  .filter(Boolean);

const numberFrom = (value: unknown) => {
  const match = String(value ?? "").replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const relatedFoodName = (foods: MealItem["foods"]) => Array.isArray(foods) ? foods[0]?.original_name : foods?.original_name;

const getRows = (payload: Record<string, unknown>): NutritionRow[] => {
  const response = payload?.response as Record<string, unknown> | undefined;
  const body = (payload?.body || response?.body) as Record<string, unknown> | undefined;
  const items = body?.items as { item?: NutritionRow | NutritionRow[] } | NutritionRow[] | undefined;
  if (Array.isArray(items)) return items;
  const item = items?.item;
  return Array.isArray(item) ? item : item ? [item] : [];
};

const pickBest = (menuName: string, rows: NutritionRow[]) => {
  const wanted = normalize(menuName);
  return rows.map((row) => {
    const candidate = normalize(row.FOOD_NM_KR || "");
    const closeLength = candidate.length <= Math.max(wanted.length + 6, Math.ceil(wanted.length * 2.5));
    const exactOnly = /^(우유|요거트|바나나|사과|오렌지|음료|식혜|제철과일|과일주스)$/u.test(wanted);
    const containsUnexpectedSauce = candidate.includes("소스") && !wanted.includes("소스");
    const allowsFuzzy = !exactOnly && !containsUnexpectedSauce && wanted.length >= 3 && closeLength;
    const baseScore = candidate === wanted ? 100
      : allowsFuzzy && (candidate.startsWith(wanted) || candidate.endsWith(wanted)) ? 75
      : allowsFuzzy && (candidate.includes(wanted) || wanted.includes(candidate)) ? 55 : 0;
    const foodGroupBonus = row.DB_GRP_NM === "음식" || row.DB_GRP_CM === "D" ? 5 : 0;
    return { row, score: baseScore > 0 ? baseScore + foodGroupBonus : 0 };
  }).filter(({ row, score }) => score > 0 && numberFrom(row.AMT_NUM1) !== null)
    .sort((a, b) => b.score - a.score
      || normalize(a.row.FOOD_NM_KR || "").length - normalize(b.row.FOOD_NM_KR || "").length
      || String(b.row.UPDATE_DATE || "").localeCompare(String(a.row.UPDATE_DATE || "")))[0]?.row;
};

const defaultServingGrams = (name: string) => {
  const value = normalize(name);
  if (/밥$|볶음밥|비빔밥|덮밥|카레라이스|짜장/.test(value)) return 200;
  if (/국$|탕$|찌개$|장국|냉국|국수|우동|묵사발/.test(value)) return 250;
  if (/김치|깍두기|석박지|단무지|장아찌|절임/.test(value)) return 40;
  if (/샐러드|무침|나물|볶음|조림/.test(value)) return 70;
  if (/우유|주스|쥬스|음료|냉차|식혜|야쿠르트|요거트/.test(value)) return 200;
  if (/과일|사과|바나나|오렌지|옥수수/.test(value)) return 100;
  if (/가스|불고기|갈비|찜닭|닭볶음탕|생선|두부|계란|달걀|떡볶이|튀김/.test(value)) return 120;
  return 80;
};

const fallbackCalories = (name: string, servingGrams: number) => {
  const value = normalize(name);
  const per100g = /밥$|볶음밥|비빔밥|덮밥|카레라이스|짜장/.test(value) ? 150
    : /국$|탕$|찌개$|장국|냉국|국수|우동|묵사발/.test(value) ? 55
    : /김치|깍두기|석박지|단무지|장아찌|절임/.test(value) ? 35
    : /샐러드|무침|나물/.test(value) ? 90
    : /볶음|조림|잡채/.test(value) ? 180
    : /가스|튀김|강정/.test(value) ? 280
    : /불고기|갈비|찜닭|닭볶음탕|생선|두부|계란|달걀|떡볶이/.test(value) ? 230
    : /우유|주스|쥬스|음료|냉차|식혜|야쿠르트|요거트/.test(value) ? 50
    : /과일|사과|바나나|오렌지|옥수수/.test(value) ? 60 : 140;
  return Math.round(per100g * servingGrams / 100);
};

const mapConcurrent = async <T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>) => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; results[index] = await work(values[index]); }
  }));
  return results;
};

const fetchDataGo = async (serviceKey: string, menuName: string) => {
  const url = new URL("https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "50");
  url.searchParams.set("type", "json");
  url.searchParams.set("FOOD_NM_KR", queryName(menuName));
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`MFDS HTTP ${response.status}`);
  const payload = await response.json();
  const code = String(payload?.header?.resultCode ?? payload?.response?.header?.resultCode ?? "00");
  if (code !== "00" && code !== "0") throw new Error(`MFDS ${code}`);
  return pickBest(menuName, getRows(payload));
};

const fetchFoodSafety = async (serviceKey: string, menuName: string) => {
  const filter = `FOOD_NM_KR=${encodeURIComponent(queryName(menuName))}`;
  const response = await fetch(`https://openapi.foodsafetykorea.go.kr/api/${serviceKey}/I2791/json/1/50/${filter}`, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`FoodSafetyKorea HTTP ${response.status}`);
  const service = (await response.json())?.I2791;
  const code = String(service?.RESULT?.CODE ?? "");
  if (!code.startsWith("INFO")) throw new Error(`FoodSafetyKorea ${code || "INVALID_RESPONSE"}`);
  return pickBest(menuName, Array.isArray(service?.row) ? service.row : []);
};

const fetchNutrition = async (foodSafetyKey: string | undefined, dataGoKey: string | undefined, menuName: string) => {
  if (dataGoKey) {
    try { const row = await fetchDataGo(dataGoKey, menuName); if (row) return { row, source: "mfds-data-go-kr" }; }
    catch (error) { console.warn("공공데이터포털 영양정보 조회 실패", error); }
  }
  if (foodSafetyKey) { const row = await fetchFoodSafety(foodSafetyKey, menuName); if (row) return { row, source: "mfds-foodsafetykorea" }; }
  return null;
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
    const mealIds = [...new Set((body?.mealIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 50);
    if (!mealIds.length) return Response.json({ estimates: [] }, { headers: corsHeaders });
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: meals, error: mealsError } = await db.from("meals")
      .select("id, meal_items(id, original_menu_text, serving_grams, foods(original_name))")
      .in("id", mealIds).eq("is_published", true).eq("is_operating", true);
    if (mealsError) throw mealsError;

    const namesByKey = new Map<string, string>();
    (meals ?? []).flatMap((meal) => meal.meal_items ?? []).forEach((item: MealItem) => {
      const name = item.original_menu_text || relatedFoodName(item.foods);
      if (name && !/^\[?천원의\s*아침밥/u.test(name)) {
        splitMenuNames(name).forEach((component) => namesByKey.set(normalize(component), component));
      }
    });
    const keys = [...namesByKey.keys()];
    const cachedResult = keys.length ? await db.from("food_nutrition_cache").select("*").in("normalized_query", keys) : { data: [], error: null };
    if (cachedResult.error) throw cachedResult.error;
    const nutritionByQuery = new Map((cachedResult.data ?? []).map((row) => [row.normalized_query, row]));

    await mapConcurrent([...namesByKey.entries()], 6, async ([key, name]) => {
      const cached = nutritionByQuery.get(key);
      const isCurrentMatchVersion = Number(cached?.raw_data?._babfull_match_version) === MATCH_VERSION;
      const lifetime = !isCurrentMatchVersion ? 0 : cached?.match_status === "matched" ? 30 * 86400000 : cached?.match_status === "no_match" ? 86400000 : 300000;
      if (cached && new Date(cached.fetched_at).getTime() > Date.now() - lifetime) return;
      try {
        const result = await fetchNutrition(foodSafetyKey, dataGoKey, name);
        const row = result?.row;
        const cacheRow = row ? {
          normalized_query: key, mfds_food_code: row.FOOD_CD, matched_name: row.FOOD_NM_KR,
          serving_amount: numberFrom(row.SERVING_SIZE) || numberFrom(row.Z10500) || 100,
          serving_unit: String(row.SERVING_SIZE || row.Z10500 || "100g"), calories_per_serving: numberFrom(row.AMT_NUM1),
          match_status: "matched", raw_data: { ...row, _babfull_source: result.source, _babfull_match_version: MATCH_VERSION }, fetched_at: new Date().toISOString(),
        } : { normalized_query: key, match_status: "no_match", raw_data: { _babfull_match_version: MATCH_VERSION }, fetched_at: new Date().toISOString() };
        await db.from("food_nutrition_cache").upsert(cacheRow as any);
        nutritionByQuery.set(key, cacheRow);
      } catch (error) {
        console.warn(`영양정보 조회 실패: ${name}`, error);
        const cacheRow = { normalized_query: key, match_status: "error", raw_data: { _babfull_match_version: MATCH_VERSION }, fetched_at: new Date().toISOString() };
        await db.from("food_nutrition_cache").upsert(cacheRow);
        nutritionByQuery.set(key, cacheRow);
      }
    });

    const updates: Array<{ id: number; values: Record<string, unknown> }> = [];
    const estimates = (meals ?? []).map((meal) => {
      const items = (meal.meal_items ?? []).map((item: MealItem) => {
        const name = item.original_menu_text || relatedFoodName(item.foods) || "";
        if (/^\[?천원의\s*아침밥/u.test(name) || /운영시간/.test(name)) {
          updates.push({ id: item.id, values: { estimated_calories: null, nutrition_matched_name: null, nutrition_source: null, nutrition_updated_at: new Date().toISOString() } });
          return { name, matched: false };
        }
        const components = splitMenuNames(name);
        const componentResults = components.map((component) => {
          const nutrition = nutritionByQuery.get(normalize(component));
          const servingGrams = components.length === 1 && Number(item.serving_grams)
            ? Number(item.serving_grams) : defaultServingGrams(component);
          if (!nutrition || nutrition.match_status !== "matched") {
            return { name: component, calories: fallbackCalories(component, servingGrams), servingGrams,
              matchedName: "메뉴 유형별 표준치", source: "category-estimate" };
          }
          return { name: component,
            calories: Math.round(Number(nutrition.calories_per_serving) * servingGrams / (Number(nutrition.serving_amount) || 100)),
            servingGrams, matchedName: nutrition.matched_name,
            source: nutrition.raw_data?._babfull_source || "mfds-data-go-kr" };
        });
        const servingGrams = componentResults.reduce((sum, component) => sum + component.servingGrams, 0);
        const calories = componentResults.reduce((sum, component) => sum + component.calories, 0);
        const apiComponents = componentResults.filter((component) => component.source !== "category-estimate").length;
        const source = apiComponents === componentResults.length ? "mfds-data-go-kr"
          : apiComponents ? "mfds-mixed" : "category-estimate";
        const matchedName = componentResults.map((component) => component.matchedName).join(" + ");
        updates.push({ id: item.id, values: { serving_grams: servingGrams, estimated_calories: calories,
          nutrition_matched_name: matchedName, nutrition_source: source, nutrition_updated_at: new Date().toISOString() } });
        return { name, matched: true, calories, servingGrams, matchedName, source,
          components: componentResults, apiMatched: apiComponents === componentResults.length };
      });
      const matched = items.filter((item) => item.matched);
      const apiMatchedItems = matched.filter((item) => item.apiMatched ?? item.source !== "category-estimate").length;
      return { mealId: meal.id, totalCalories: matched.reduce((sum, item) => sum + (item.calories || 0), 0),
        matchedItems: matched.length, apiMatchedItems, totalItems: items.length,
        source: apiMatchedItems === matched.length ? "mfds" : "mfds-mixed", items };
    });
    await mapConcurrent(updates, 12, async ({ id, values }) => { const { error } = await db.from("meal_items").update(values).eq("id", id); if (error) throw error; });
    return Response.json({ estimates, persistedItems: updates.length }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "영양정보를 계산하지 못했습니다." }, { status: 500, headers: corsHeaders });
  }
});
