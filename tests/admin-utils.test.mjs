import test from "node:test";
import assert from "node:assert/strict";
import { getAutomaticMealType, getManualMealState } from "../js/admin-utils.js";

const settings = {
  breakfastStart: "08:00",
  breakfastEnd: "09:30",
  lunchStart: "11:30",
  lunchEnd: "14:00",
  scanBufferMinutes: 30,
};

test("조식 제공시간 전후 30분은 조식으로 자동 선택한다", () => {
  assert.equal(getAutomaticMealType(new Date("2026-10-20T22:30:00Z"), settings), "breakfast");
  assert.equal(getAutomaticMealType(new Date("2026-10-21T01:00:00Z"), settings), "breakfast");
});

test("중식 제공시간 전후 30분은 중식으로 자동 선택한다", () => {
  assert.equal(getAutomaticMealType(new Date("2026-10-21T02:00:00Z"), settings), "lunch");
  assert.equal(getAutomaticMealType(new Date("2026-10-21T05:30:00Z"), settings), "lunch");
});

test("관리자가 변경한 허용 범위를 자동 선택에 반영한다", () => {
  const strict = { ...settings, scanBufferMinutes: 0 };
  const elevenFifteen = new Date("2026-10-21T02:15:00Z");
  assert.equal(getAutomaticMealType(elevenFifteen, settings), "lunch");
  assert.equal(getAutomaticMealType(elevenFifteen, strict), "breakfast");
});

test("수동 식단 제공 여부를 저장 상태로 변환한다", () => {
  assert.deepEqual(getManualMealState("provided", [" 백미밥 "]), { menuItems: ["백미밥"], isOperating: true, adminNote: null });
  assert.deepEqual(getManualMealState("unavailable", ["테스트"]), { menuItems: [], isOperating: false, adminNote: "미제공" });
  assert.deepEqual(getManualMealState("closed", ["테스트"], "문화체험 휴무"), { menuItems: [], isOperating: false, adminNote: "문화체험 휴무" });
});
