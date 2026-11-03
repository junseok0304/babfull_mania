import assert from "node:assert/strict";
import test from "node:test";

import { getHorizontalSwipeDirection } from "../js/swipe-utils.js";

test("왼쪽 스와이프는 다음 식단 날짜로 이동한다", () => {
  assert.equal(getHorizontalSwipeDirection({ startX: 320, startY: 200, endX: 180, endY: 208 }), 1);
});

test("오른쪽 스와이프는 이전 식단 날짜로 이동한다", () => {
  assert.equal(getHorizontalSwipeDirection({ startX: 80, startY: 200, endX: 230, endY: 194 }), -1);
});

test("짧은 이동과 세로 스크롤은 날짜 스와이프로 오인하지 않는다", () => {
  assert.equal(getHorizontalSwipeDirection({ startX: 200, startY: 200, endX: 170, endY: 202 }), 0);
  assert.equal(getHorizontalSwipeDirection({ startX: 200, startY: 100, endX: 150, endY: 260 }), 0);
});
