import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("사용자 브라우저는 영양정보 Edge Function을 직접 호출하지 않는다", async () => {
  const source = await read("../js/nutrition-service.js");
  assert.doesNotMatch(source, /functions\.invoke|estimate-meal-calories/);
  assert.match(source, /persistedEstimate\(meal\)/);
  assert.match(source, /source: "pending"/);
});

test("식단 가져오기가 변경된 식단의 열량 저장을 서버 권한으로 실행한다", async () => {
  const source = await read("../supabase/functions/import-yeongjun-menu/index.ts");
  assert.match(source, /nutritionMealIds/);
  assert.match(source, /Authorization: `Bearer \$\{serviceRoleKey\}`/);
  assert.match(source, /detail_data: detailData/);
});

test("영양정보 계산 함수는 서비스 역할 토큰만 허용한다", async () => {
  const source = await read("../supabase/functions/estimate-meal-calories/index.ts");
  assert.match(source, /authorization !== `Bearer \$\{serviceRoleKey\}`/);
  assert.match(source, /status: 403/);
});

test("폐기한 외부 메뉴 이미지 검색 함수는 소스에서 제거됐다", async () => {
  await assert.rejects(access(new URL("../supabase/functions/resolve-food-images/index.ts", import.meta.url), constants.F_OK));
  await assert.rejects(access(new URL("../supabase/functions/manage-food-image/index.ts", import.meta.url), constants.F_OK));
  await assert.rejects(access(new URL("../js/food-image-service.js", import.meta.url), constants.F_OK));
});
