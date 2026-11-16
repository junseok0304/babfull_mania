import test from "node:test";
import assert from "node:assert/strict";
import { ADSENSE_CLIENT_ID, normalizeAdsenseSettings } from "../js/adsense.js";

test("광고 설정은 명시적으로 켠 경우에만 활성화한다", () => {
  assert.deepEqual(normalizeAdsenseSettings({ enabled: true, slot_id: " 1234567890 " }), {
    enabled: true,
    slotId: "1234567890",
  });
  assert.equal(normalizeAdsenseSettings({ enabled: "true", slot_id: "1234567890" }).enabled, false);
});

test("잘못된 광고 단위 ID는 렌더링 설정에서 제거한다", () => {
  assert.equal(normalizeAdsenseSettings({ enabled: true, slotId: "abc-123" }).slotId, "");
  assert.equal(normalizeAdsenseSettings({ enabled: true, slotId: "12345" }).slotId, "");
  assert.equal(ADSENSE_CLIENT_ID, "ca-pub-9030402652749847");
});
