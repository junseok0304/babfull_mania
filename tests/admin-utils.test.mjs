import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSummary, getAutomaticMealType, getManualMealState, isDuplicateMealUsageError, normalizeKakaoShareStats, shouldShowClosureReason } from "../js/admin-utils.js";

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

test("휴무 사유는 휴무를 선택한 경우에만 표시한다", () => {
  assert.equal(shouldShowClosureReason("provided"), false);
  assert.equal(shouldShowClosureReason("unavailable"), false);
  assert.equal(shouldShowClosureReason("closed"), true);
});

test("이미 처리된 식권 오류를 중복 사용 상태로 구분한다", () => {
  assert.equal(isDuplicateMealUsageError(new Error("이미 사용 처리된 식권입니다.")), true);
  assert.equal(isDuplicateMealUsageError(new Error("이미 오늘 사용 처리된 식권입니다.")), true);
  assert.equal(isDuplicateMealUsageError({ code: "23505", message: "duplicate key" }), true);
  assert.equal(isDuplicateMealUsageError(new Error("유효한 사용자를 찾을 수 없습니다.")), false);
});

test("월간 대시보드 집계값과 식사 이용 비율을 계산한다", () => {
  assert.deepEqual(buildDashboardSummary({
    total_members: 12, today_usage_count: 3, month_usage_count: 10, month_revenue: 31800,
    breakfast_count: 4, lunch_count: 6, affiliations: [{ affiliation: "IT융합자율학부", count: 7 }],
  }), {
    totalMembers: 12, todayUsageCount: 3, monthUsageCount: 10, monthRevenue: 31800,
    breakfastCount: 4, lunchCount: 6, breakfastPercent: 40, lunchPercent: 60,
    affiliations: [{ affiliation: "IT융합자율학부", count: 7 }],
  });
});

test("이용 기록이 없을 때 대시보드 비율은 0으로 안전하게 표시한다", () => {
  const summary = buildDashboardSummary();
  assert.equal(summary.breakfastPercent, 0);
  assert.equal(summary.lunchPercent, 0);
  assert.deepEqual(summary.affiliations, []);
});

test("사용자별 카카오 공유 집계값을 관리자 표시 형식으로 변환한다", () => {
  assert.deepEqual(normalizeKakaoShareStats([{
    user_id: "user-1", user_name: "윤준석", affiliation: "소프트웨어융합학부", share_count: "3", last_shared_at: "2026-10-31T12:00:00Z",
  }]), [{
    userId: "user-1", name: "윤준석", affiliation: "소프트웨어융합학부", count: 3, lastSharedAt: "2026-10-31T12:00:00Z",
  }]);
});
