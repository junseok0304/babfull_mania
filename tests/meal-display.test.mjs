import test from "node:test";
import assert from "node:assert/strict";

import { arrangeTray, resolveHomeAvailability, resolveTrayPresentation } from "../js/meal-display.js";

test("김치와 장류도 별도 작은 칸 없이 일반 반찬 순서로 배치한다", () => {
  const arranged = arrangeTray(["백미밥", "콩나물국", "돈육김치볶음", "깍두기", "쌈장"]);

  assert.deepEqual(arranged, [
    { name: "백미밥", slot: "rice" },
    { name: "콩나물국", slot: "soup" },
    { name: "돈육김치볶음", slot: "side-1" },
    { name: "깍두기", slot: "side-2" },
    { name: "쌈장", slot: "side-3" },
  ]);
  assert.equal(arranged.some(({ slot }) => slot === "small"), false);
});

test("반찬 다섯 개는 남는 우측 세로 칸까지 사용해 넓게 배치한다", () => {
  const arranged = arrangeTray([
    "흑미밥",
    "미역국",
    "제육볶음",
    "감자조림",
    "콩나물무침",
    "배추김치",
    "양배추샐러드",
  ]);

  assert.deepEqual(arranged.map(({ slot }) => slot), [
    "rice",
    "soup",
    "side-1",
    "side-2",
    "side-3",
    "side-4",
    "side-5",
  ]);
});

test("남는 칸보다 반찬이 많을 때만 큰 반찬 칸을 분할한다", () => {
  const arranged = arrangeTray(["백미밥", "미역국", "제육볶음", "감자조림", "콩나물무침", "배추김치", "샐러드", "잡채", "과일"]);
  assert.deepEqual(arranged.map(({ slot }) => slot), [
    "rice", "soup", "side-1-top", "side-1-bottom", "side-2-top", "side-2-bottom", "side-3", "side-4", "small",
  ]);
});

test("등록된 식단이 없는 평일은 휴무가 아닌 미제공 상태다", () => {
  const result = resolveHomeAvailability([], new Date("2026-10-26T00:00:00"));

  assert.equal(result.state, "empty");
  assert.deepEqual(result.visibleMeals, []);
});

test("휴무 기록이 있는 날은 메뉴 대신 휴무 상태와 사유를 제공한다", () => {
  const result = resolveHomeAvailability([
    { operating: false, items: [], note: "문화체험 휴무" },
    { operating: false, items: [], note: "문화체험 휴무" },
  ], new Date("2026-10-22T00:00:00"));

  assert.equal(result.state, "closed");
  assert.deepEqual(result.closedNotes, ["문화체험 휴무"]);
});

test("조식이 없어도 중식 메뉴가 있으면 제공 상태를 유지한다", () => {
  const lunch = { type: "lunch", operating: true, items: ["백미밥", "미역국"] };
  const result = resolveHomeAvailability([lunch], new Date("2026-10-23T00:00:00"));

  assert.equal(result.state, "available");
  assert.deepEqual(result.visibleMeals, [lunch]);
});

test("AI 모드라도 완성 식판 이미지가 없으면 메뉴명 식판으로 대체한다", () => {
  assert.equal(resolveTrayPresentation("ai", null), "menu-text");
  assert.equal(resolveTrayPresentation("ai", {}), "menu-text");
  assert.equal(resolveTrayPresentation("ai", { imageUrl: "https://example.com/tray.webp" }), "generated");
  assert.equal(resolveTrayPresentation("search", { imageUrl: "https://example.com/tray.webp" }), "menu-images");
});
