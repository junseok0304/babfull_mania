import test from "node:test";
import assert from "node:assert/strict";

import { bindMealKakaoSharePicker, openMealKakaoSharePicker } from "../js/kakao-share.js";

test("공식 카카오 공유창에 식단 템플릿 인자를 전달한다", () => {
  let initializedKey = null;
  let shareRequest = null;
  global.window = {
    Kakao: {
      isInitialized: () => Boolean(initializedKey),
      init: (key) => {
        initializedKey = key;
        global.window.Kakao.Share = { sendCustom: (request) => { shareRequest = request; } };
      },
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

test("모바일 호환 공식 공유 버튼을 SDK에 직접 연결한다", async () => {
  let shareRequest = null;
  let clickHandler = null;
  global.window = {
    Kakao: {
      isInitialized: () => true,
      init: () => {},
      Share: { createCustomButton: (request) => { shareRequest = request; } },
    },
  };
  const button = {
    id: "",
    disabled: false,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: (eventName, handler) => {
      if (eventName === "click") clickHandler = handler;
    },
  };

  const result = await bindMealKakaoSharePicker(button, {
    type: "breakfast",
    date: "2026-10-30",
    items: ["백미밥", "미역국"],
    trayImage: { imageUrl: "https://example.com/breakfast.png" },
  });

  assert.equal(result.bound, true);
  assert.equal(button.disabled, false);
  assert.match(button.id, /^kakao-share-button-/);
  assert.equal(shareRequest.container, `#${button.id}`);
  assert.equal(shareRequest.templateId, 138483);
  assert.equal(shareRequest.templateArgs.time, "조식");
  assert.equal(typeof clickHandler, "function");
  delete global.window;
});
