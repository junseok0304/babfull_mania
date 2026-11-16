import test from "node:test";
import assert from "node:assert/strict";
import { ADSENSE_CLIENT_ID, normalizeAdsenseSettings } from "../js/adsense.js";

test("광고 설정은 명시적으로 켠 경우에만 활성화한다", () => {
  assert.deepEqual(normalizeAdsenseSettings({ enabled: true }), { enabled: true });
  assert.equal(normalizeAdsenseSettings({ enabled: "true" }).enabled, false);
});

test("자동 광고는 고정된 게시자 ID를 사용한다", () => {
  assert.equal(ADSENSE_CLIENT_ID, "ca-pub-9030402652749847");
});
