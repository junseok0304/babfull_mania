import { sampleMeals } from "./sample-data.js";
import { getSupabaseClient } from "./supabase-client.js";

let cachedMeals = sampleMeals;
let dataMode = "preview";

const mapMeal = (record) => ({
  id: record.id,
  date: record.meal_date,
  type: record.meal_type,
  published: record.is_published,
  items: [...(record.meal_items ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map((item) => item.original_menu_text || item.foods?.original_name)
    .filter(Boolean),
});

export const initializeData = async () => {
  const client = await getSupabaseClient();
  if (!client) return { mode: dataMode, meals: cachedMeals };

  const { data, error } = await client
    .from("meals")
    .select("id, meal_date, meal_type, is_published, meal_items(display_order, original_menu_text, foods(original_name))")
    .eq("is_published", true)
    .order("meal_date", { ascending: true });

  if (error) {
    console.warn("공개 식단을 불러오지 못해 로컬 예시 데이터를 사용합니다.");
    return { mode: dataMode, meals: cachedMeals, error };
  }

  cachedMeals = (data ?? []).map(mapMeal);
  dataMode = "supabase";
  return { mode: dataMode, meals: cachedMeals };
};

export const getCachedMeals = () => cachedMeals;
export const getDataMode = () => dataMode;
