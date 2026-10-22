import test from "node:test";
import assert from "node:assert/strict";

import { arrangeTray } from "../js/meal-display.js";

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

test("반찬이 많은 식단은 큰 반찬 칸을 위아래로 나누어 모두 표시한다", () => {
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
    "side-1-top",
    "side-1-bottom",
    "side-2-top",
    "side-2-bottom",
    "side-3",
  ]);
});
