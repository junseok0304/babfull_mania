import { getSupabaseClient } from "./supabase-client.js";

const mealCache = new Map();

// API 키가 없는 로컬 시연에서도 레이아웃을 확인할 수 있는 1회 제공량 기준 예시값입니다.
const localCalories = {
  백미밥: 300, 잡곡밥: 290, 흑미밥: 295,
  미역국: 45, 팽이버섯된장국: 65, 콩나물국: 55, 김치찌개: 125,
  어묵국: 90, 순두부찌개: 180, 북엇국: 85, 유부장국: 70,
  된장국: 70, 육개장: 210,
  계란말이: 145, 수제돈가스: 430, 소시지볶음: 230, 제육볶음: 330,
  두부조림: 145, 닭갈비: 310, 고기산적: 260, 생선가스: 340,
  스크램블에그: 180, 간장불고기: 320,
  도시락김: 25, 배추김치: 20, 깍두기: 25, 단무지: 15,
  오이무침: 35, 무말랭이무침: 70, 양배추샐러드: 85, 감자조림: 110,
  연근조림: 105, 상추겉절이: 35, 콩나물무침: 45, 멸치볶음: 95,
  감자채볶음: 120, 시금치무침: 45, 무생채: 40, 떡볶이: 260,
  진미채볶음: 110, 청포묵무침: 80, 애호박볶음: 70,
};

const itemName = (item) => typeof item === "string" ? item : item.name;

const persistedEstimate = (meal) => {
  const items = meal.menuItems ?? [];
  const matched = items.filter((item) => Number.isFinite(item.estimatedCalories));
  if (!matched.length) return null;
  const apiMatchedItems = matched.filter((item) => item.nutritionSource !== "category-estimate").length;
  return {
    mealId: meal.id,
    totalCalories: matched.reduce((sum, item) => sum + item.estimatedCalories, 0),
    matchedItems: matched.length,
    apiMatchedItems,
    totalItems: items.length,
    source: apiMatchedItems === matched.length ? "mfds" : "mfds-mixed",
    items: items.map((item) => ({ name: item.name, matched: Number.isFinite(item.estimatedCalories), calories: item.estimatedCalories })),
  };
};

const localEstimate = (meal) => {
  const items = meal.menuItems?.length ? meal.menuItems : meal.items;
  const values = items.map(itemName).map((name) => localCalories[name]).filter(Number.isFinite);
  return {
    mealId: meal.id,
    totalCalories: values.reduce((sum, value) => sum + value, 0),
    matchedItems: values.length,
    totalItems: items.length,
    source: "preview",
  };
};

export const getMealNutrition = (meal) => mealCache.get(String(meal.id)) || persistedEstimate(meal) || localEstimate(meal);

export const hydrateMealNutrition = async (meals) => {
  meals.forEach((meal) => {
    const persisted = persistedEstimate(meal);
    if (persisted && persisted.matchedItems === persisted.totalItems) mealCache.set(String(meal.id), persisted);
  });
  const pending = meals.filter((meal) => !mealCache.has(String(meal.id)));
  if (!pending.length) return;

  const client = await getSupabaseClient();
  const numericIds = pending.map((meal) => meal.id).filter((id) => /^\d+$/.test(String(id)));
  if (client && numericIds.length) {
    try {
      const { data, error } = await client.functions.invoke("estimate-meal-calories", {
        body: { mealIds: numericIds },
      });
      if (!error && Array.isArray(data?.estimates)) {
        data.estimates.forEach((estimate) => mealCache.set(String(estimate.mealId), estimate));
      }
    } catch (error) {
      console.warn("영양정보 서버를 불러오지 못해 로컬 예상치를 사용합니다.", error);
    }
  }

  pending.forEach((meal) => {
    if (!mealCache.has(String(meal.id))) mealCache.set(String(meal.id), localEstimate(meal));
  });
};
