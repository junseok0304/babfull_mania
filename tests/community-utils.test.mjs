import assert from "node:assert/strict";
import test from "node:test";

import {
  canViewSuggestion,
  clampLikeCount,
  normalizeCommunityText,
  selectFeaturedNotice,
  validateSuggestion,
} from "../js/community-utils.js";

test("건의 제목의 연속 공백은 한 칸으로 정리한다", () => {
  assert.equal(normalizeCommunityText("  조식   운영  시간  "), "조식 운영 시간");
});

test("정상적인 실명 건의는 정규화된 값으로 검증된다", () => {
  assert.deepEqual(
    validateSuggestion({ authorName: " 윤준석 ", title: " 메뉴   제안 ", body: "채소 메뉴를 늘려주세요." }),
    { authorName: "윤준석", title: "메뉴 제안", body: "채소 메뉴를 늘려주세요." },
  );
});

test("실명이 없는 프로필은 건의를 작성할 수 없다", () => {
  assert.throws(
    () => validateSuggestion({ authorName: " ", title: "메뉴 제안", body: "채소 메뉴를 늘려주세요." }),
    /실명 프로필/,
  );
});

test("제목과 본문의 최소 길이 경계값을 검증한다", () => {
  assert.doesNotThrow(() => validateSuggestion({ authorName: "학생", title: "건의", body: "12345" }));
  assert.throws(() => validateSuggestion({ authorName: "학생", title: "건", body: "12345" }), /제목은 2자/);
  assert.throws(() => validateSuggestion({ authorName: "학생", title: "건의", body: "1234" }), /내용은 5자/);
});

test("비밀 건의는 운영진에게만, 공개 건의는 모두에게 노출된다", () => {
  assert.equal(canViewSuggestion({ isPrivate: true }, false), false);
  assert.equal(canViewSuggestion({ isPrivate: true }, true), true);
  assert.equal(canViewSuggestion({ isPrivate: false }, false), true);
});

test("대표 공지가 없으면 최신 목록의 첫 공지를 배너로 선택한다", () => {
  const ordinary = [{ id: 3, isFeatured: false }, { id: 2, isFeatured: false }];
  assert.equal(selectFeaturedNotice(ordinary)?.id, 3);
  assert.equal(selectFeaturedNotice([]), null);
});

test("대표 공지가 있으면 목록 순서와 무관하게 우선 선택한다", () => {
  const notices = [{ id: 3, isFeatured: false }, { id: 2, isFeatured: true }];
  assert.equal(selectFeaturedNotice(notices)?.id, 2);
});

test("좋아요 수는 잘못된 값이나 음수여도 0 미만으로 내려가지 않는다", () => {
  assert.equal(clampLikeCount(-3), 0);
  assert.equal(clampLikeCount("not-a-number"), 0);
  assert.equal(clampLikeCount("7"), 7);
});
