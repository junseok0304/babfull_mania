import { getSupabaseClient } from "./supabase-client.js";

/**
 * 식단 메뉴의 검수된 대표 사진을 묶음 조회하고 이름 기준으로 캐시합니다.
 * 운영 문구나 미제공 상태는 음식 검색에서 제외하며, 실패한 이미지는 다음 렌더에서 다시 조회할 수 있습니다.
 */
const imageCache = new Map();
const pendingNames = new Set();

const normalize = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "").trim();
const isFoodName = (name) => name && !/^\[?천원의\s*아침밥/u.test(name) && !/운영시간|메뉴가 없습니다|휴무/u.test(name);

export const getFoodImage = (name) => imageCache.get(normalize(name)) || null;

export const hydrateMealImages = async (meals) => {
  const names = [...new Set(meals.flatMap((meal) => meal.items ?? []).filter(isFoodName))]
    .filter((name) => !imageCache.has(normalize(name)) && !pendingNames.has(normalize(name)))
    .slice(0, 30);
  if (!names.length) return;
  names.forEach((name) => pendingNames.add(normalize(name)));

  try {
    const client = await getSupabaseClient();
    if (!client) return;
    const { data, error } = await client.functions.invoke("resolve-food-images", { body: { foodNames: names } });
    if (error) throw error;
    (data?.images ?? []).forEach((image) => {
      if (image?.imageUrl || image?.fallbackUrl) imageCache.set(normalize(image.name), image);
    });
  } catch (error) {
    console.warn("음식 이미지를 불러오지 못했습니다.", error);
  } finally {
    names.forEach((name) => pendingNames.delete(normalize(name)));
  }
};

export const markFoodImageFailed = (name) => imageCache.delete(normalize(name));
