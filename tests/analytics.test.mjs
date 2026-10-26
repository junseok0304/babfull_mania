import test from "node:test";
import assert from "node:assert/strict";

import { analyticsPagePath, GA_MEASUREMENT_ID } from "../js/analytics.js";

test("GA4 측정 ID와 SPA 화면 경로를 일관되게 사용한다", () => {
  assert.equal(GA_MEASUREMENT_ID, "G-DTRPCFHW7Q");
  assert.equal(analyticsPagePath("home"), "/");
  assert.equal(analyticsPagePath("weekly"), "/weekly");
  assert.equal(analyticsPagePath("mypage"), "/mypage");
  assert.equal(analyticsPagePath("terms"), "/terms");
  assert.equal(analyticsPagePath("privacy"), "/privacy");
});
