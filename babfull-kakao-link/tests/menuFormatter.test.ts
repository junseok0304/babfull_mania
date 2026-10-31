import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { charLength, formatMenuTemplateVariables, formatMenuText, MenuFormatError } from "../src/templates/menuFormatter.js";

describe("formatMenuText", () => {
  it("정확히 24글자인 한 줄을 유지한다", () => {
    const menu = "가".repeat(24);
    assert.equal(formatMenuText([menu]), menu);
    assert.equal(charLength(formatMenuText([menu])), 24);
  });

  it("다음 메뉴 추가 시 25글자 이상이면 다음 줄로 이동한다", () => {
    const first = "가".repeat(22);
    assert.equal(formatMenuText([first, "나"]), `${first}\n나`);
  });

  it("23~24번째 위치에 시작할 음식명을 통째로 다음 줄로 보낸다", () => {
    const first = "가".repeat(21);
    assert.equal(formatMenuText([first, "새우튀김"]), `${first}\n새우튀김`);
  });

  it("새우튀김을 중간에서 분리하지 않는다", () => {
    const result = formatMenuText(["가".repeat(21), "새우튀김", "김치"]);
    assert.deepEqual(result.split("\n"), ["가".repeat(21), "새우튀김, 김치"]);
  });

  it("공백이 포함된 음식명을 하나의 항목으로 취급하고 내부 공백만 정리한다", () => {
    assert.equal(
      formatMenuText(["백미밥", "  소고기   미역국 ", "매콤 달콤 새우튀김", "배추김치"]),
      "백미밥, 소고기 미역국, 매콤 달콤 새우튀김\n배추김치",
    );
  });

  it("24글자를 초과하는 단일 메뉴명을 거부한다", () => {
    assert.throws(() => formatMenuText(["가".repeat(25)]), MenuFormatError);
    assert.throws(() => formatMenuText(["가".repeat(25)]), /메뉴명이 24글자를 초과합니다/);
  });

  it("메뉴가 하나만 있으면 그대로 반환한다", () => {
    assert.equal(formatMenuText(["백미밥"]), "백미밥");
  });

  it("빈 문자열을 제외한다", () => {
    assert.equal(formatMenuText(["", "  ", "백미밥", "\t", "김치"]), "백미밥, 김치");
  });

  it("모든 메뉴가 빈 값이면 오류를 반환한다", () => {
    assert.throws(() => formatMenuText(["", "  ", "\t"]), /메뉴 데이터가 없습니다/);
  });

  it("한글·영문·특수문자와 결합 문자를 사용자에게 보이는 글자 단위로 센다", () => {
    assert.equal(charLength("김치 BBQ&🍚 e\u0301"), 10);
    assert.equal(formatMenuText(["김치", "BBQ&🍚", "e\u0301"]), "김치, BBQ&🍚, e\u0301");
  });

  it("요청서의 일반 메뉴 예시를 24글자 이하 줄로 만든다", () => {
    assert.equal(formatMenuText([
      "백미밥", "우동장국", "쫄면", "김말이&만두튀김", "풋고추된장무침", "김치", "마카로니샐러드",
    ]), "백미밥, 우동장국, 쫄면, 김말이&만두튀김\n풋고추된장무침, 김치, 마카로니샐러드");
  });
});

describe("formatMenuTemplateVariables", () => {
  it("모든 메뉴를 순서대로 두 사용자 인자에 균형 분할한다", () => {
    assert.deepEqual(formatMenuTemplateVariables([
      "백미밥", "우동장국", "쫄면", "김말이&만두튀김", "풋고추된장무침", "김치", "마카로니샐러드",
    ]), {
      menuText2: "백미밥·우동장국·쫄면·김말이&만두튀김",
      menuText: "풋고추된장무침·김치·마카로니샐러드",
    });
  });
});
