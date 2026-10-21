import { appSettings, sampleMeals } from "./sample-data.js";
import { getSupabaseClient } from "./supabase-client.js";

let cachedMeals = sampleMeals;
let dataMode = "preview";

const mapMeal = (record) => ({
  id: record.id,
  date: record.meal_date,
  type: record.meal_type,
  published: record.is_published,
  operating: record.is_operating,
  note: record.admin_note,
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
  const client = await getSupabaseClient();
  if (!client) return { mode: dataMode, meals: cachedMeals };

  const [{ data, error }, { data: settings }] = await Promise.all([
    client.from("meals")
      .select("id, meal_date, meal_type, is_published, is_operating, admin_note, meal_items(display_order, original_menu_text, serving_grams, estimated_calories, nutrition_matched_name, nutrition_source, nutrition_updated_at, foods(original_name))")
      .eq("is_published", true)
      .order("meal_date", { ascending: true }),
    client.from("app_settings").select("setting_key, setting_value").in("setting_key", ["meal_hours", "meal_prices"]),
  ]);

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
  });
  dataMode = "supabase";
  return { mode: dataMode, meals: cachedMeals };
};

export const getCachedMeals = () => cachedMeals;
export const getDataMode = () => dataMode;
