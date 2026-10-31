import test from "node:test";
import assert from "node:assert/strict";

import { buildKakaoTemplateArgs, formatKakaoMenuText, formatKakaoMenuVariables } from "../js/kakao-message.js";

test("메뉴 이름을 자르지 않고 24글자 이하 줄로 만든다", () => {
  const text = formatKakaoMenuText([
    "백미밥", "우동장국", "쫄면", "김말이&만두튀김", "풋고추된장무침", "김치", "마카로니샐러드",
  ]);
  assert.equal(text, "백미밥, 우동장국, 쫄면, 김말이&만두튀김\n풋고추된장무침, 김치, 마카로니샐러드");
});

test("카카오 카드의 두 변수에 모든 메뉴명을 순서대로 균형 분할한다", () => {
  assert.deepEqual(
    formatKakaoMenuVariables(["백미밥", "우동장국", "쫄면", "김말이&만두튀김", "풋고추된장무침", "김치", "마카로니샐러드"]),
    {
      menuText2: "백미밥·우동장국·쫄면·김말이&만두튀김",
      menuText: "풋고추된장무침·김치·마카로니샐러드",
    },
  );
});

test("조식 식단을 카카오 템플릿 인자로 변환한다", () => {
  const args = buildKakaoTemplateArgs({
    type: "breakfast",
    date: "2026-10-30",
    items: ["백미밥", "미역국"],
    trayImage: { imageUrl: "https://example.com/breakfast.png" },
  });
  assert.deepEqual(args, {
    time: "조식",
    menuText2: "백미밥",
    menuText: "미역국",
    day: "30",
    image: "https://example.com/breakfast.png",
    month: "10",
  });
});

test("중식 식단은 time을 중식으로 전달한다", () => {
  const args = buildKakaoTemplateArgs({
    type: "lunch",
    date: "2026-11-02",
    items: ["잡곡밥"],
    trayImage: { imageUrl: "https://example.com/lunch.png" },
  });
  assert.equal(args.time, "중식");
  assert.equal(args.month, "11");
  assert.equal(args.day, "2");
});

test("공개 HTTPS 식판 이미지가 없으면 전송 데이터를 만들지 않는다", () => {
  assert.throws(() => buildKakaoTemplateArgs({
    type: "lunch", date: "2026-11-02", items: ["잡곡밥"], trayImage: null,
  }), /식판 이미지/);
});
