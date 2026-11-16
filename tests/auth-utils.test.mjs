import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExternalImageUrl } from "../js/auth.js";

test("HTTP 카카오 프로필 이미지는 HTTPS로 정규화한다", () => {
  assert.equal(
    normalizeExternalImageUrl("http://k.kakaocdn.net/example/profile.jpg"),
    "https://k.kakaocdn.net/example/profile.jpg",
  );
});

test("이미 HTTPS인 프로필 이미지와 빈 값은 그대로 유지한다", () => {
  assert.equal(normalizeExternalImageUrl("https://k.kakaocdn.net/example/profile.jpg"), "https://k.kakaocdn.net/example/profile.jpg");
  assert.equal(normalizeExternalImageUrl(null), "");
});
