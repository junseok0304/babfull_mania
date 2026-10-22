import { appSettings, sampleMeals } from "./sample-data.js";
import { getSupabaseClient } from "./supabase-client.js";

let cachedMeals = sampleMeals;
let dataMode = "preview";

const firstRelated = (value) => Array.isArray(value) ? value[0] : value;

const withTimeout = (promise, timeoutMs, message) => Promise.race([
  promise,
  new Promise((_, reject) => window.setTimeout(() => reject(new Error(message)), timeoutMs)),
]);

const mapMeal = (record) => ({
  id: record.id,
  date: record.meal_date,
  type: record.meal_type,
  published: record.is_published,
  operating: record.is_operating,
  note: record.admin_note,
  trayImage: firstRelated(record.meal_tray_images) ? {
    imageUrl: firstRelated(record.meal_tray_images).image_url,
    altText: firstRelated(record.meal_tray_images).alt_text,
  } : null,
  items: [...(record.meal_items ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map((item) => item.original_menu_text || item.foods?.original_name)
    .filter(Boolean),
  menuItems: [...(record.meal_items ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map((item) => ({
      name: item.original_menu_text || item.foods?.original_name,
      servingGrams: item.serving_grams ? Number(item.serving_grams) : null,
      estimatedCalories: item.estimated_calories === null ? null : Number(item.estimated_calories),
      nutritionMatchedName: item.nutrition_matched_name || null,
      nutritionSource: item.nutrition_source || null,
      nutritionUpdatedAt: item.nutrition_updated_at || null,
    }))
    .filter((item) => item.name),
});

export const initializeData = async () => {
  let client;
  try {
    client = await withTimeout(getSupabaseClient(), 6000, "데이터 연결 시간을 초과했습니다.");
  } catch (error) {
    console.warn("공개 식단 연결이 지연되어 예시 데이터를 사용합니다.");
    return { mode: dataMode, meals: cachedMeals, error };
  }
  if (!client) return { mode: dataMode, meals: cachedMeals };

  let queryResults;
  try {
    queryResults = await withTimeout(Promise.all([
    client.from("meals")
      .select("id, meal_date, meal_type, is_published, is_operating, admin_note, meal_tray_images(image_url, alt_text), meal_items(display_order, original_menu_text, serving_grams, estimated_calories, nutrition_matched_name, nutrition_source, nutrition_updated_at, foods(original_name))")
      .eq("is_published", true)
      .order("meal_date", { ascending: true }),
    client.from("app_settings").select("setting_key, setting_value").in("setting_key", ["meal_hours", "meal_prices", "tray_display_mode"]),
    ]), 7000, "식단 조회 시간을 초과했습니다.");
  } catch (error) {
    console.warn("공개 식단 조회가 지연되어 예시 데이터를 사용합니다.");
    return { mode: dataMode, meals: cachedMeals, error };
  }
  const [{ data, error }, { data: settings }] = queryResults;

  if (error) {
    console.warn("공개 식단을 불러오지 못해 로컬 예시 데이터를 사용합니다.");
    return { mode: dataMode, meals: cachedMeals, error };
  }

  cachedMeals = (data ?? []).map(mapMeal);
  (settings ?? []).forEach(({ setting_key: key, setting_value: value }) => {
    if (key === "meal_hours") Object.assign(appSettings, {
      breakfastStart: value.breakfast_start || appSettings.breakfastStart,
      breakfastEnd: value.breakfast_end || appSettings.breakfastEnd,
      lunchStart: value.lunch_start || appSettings.lunchStart,
      lunchEnd: value.lunch_end || appSettings.lunchEnd,
    });
    if (key === "meal_prices") Object.assign(appSettings, {
      breakfastPrice: Number(value.breakfast ?? 1000),
      lunchPrice: Number(value.lunch ?? 5300),
    });
    if (key === "tray_display_mode") appSettings.trayDisplayMode = value.mode === "ai" ? "ai" : "search";
  });
  dataMode = "supabase";
  return { mode: dataMode, meals: cachedMeals };
};

export const getCachedMeals = () => cachedMeals;
export const getDataMode = () => dataMode;
