import test from "node:test";
import assert from "node:assert/strict";

import { openMealKakaoSharePicker } from "../js/kakao-share.js";

test("공식 카카오 공유창에 식단 템플릿 인자를 전달한다", () => {
  let initializedKey = null;
  let shareRequest = null;
  global.window = {
    Kakao: {
      isInitialized: () => false,
      init: (key) => { initializedKey = key; },
      Share: { sendCustom: (request) => { shareRequest = request; } },
    },
  };

  const result = openMealKakaoSharePicker({
    type: "lunch",
    date: "2026-10-30",
    items: ["백미밥", "우동장국"],
    trayImage: { imageUrl: "https://example.com/tray.png" },
  });

  assert.equal(initializedKey, "38a2a6d37a352a1a567f10ee8d1a0cec");
  assert.equal(result.opened, true);
  assert.equal(shareRequest.templateId, 138483);
  assert.equal(shareRequest.templateArgs.time, "중식");
  assert.equal(shareRequest.templateArgs.image, "https://example.com/tray.png");
  delete global.window;
});
