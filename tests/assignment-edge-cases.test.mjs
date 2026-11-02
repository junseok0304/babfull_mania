/**
 * AI활용프로그래밍 11주차 과제용 테스트
 *
 * 평가자가 테스트 의도를 빠르게 확인할 수 있도록 정상값뿐 아니라
 * 경계값(boundary), 예외(exception), 외부 API Mock을 한 파일에 정리했다.
 * 이 파일은 .vercelignore의 tests 규칙으로 운영 배포에서는 제외되며,
 * 저장소에는 남아 과제 제출 및 회귀 테스트에 사용할 수 있다.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  buildKakaoTemplateArgs,
  formatKakaoMenuText,
} from "../js/kakao-message.js";
import {
  getAutomaticMealType,
  getManualMealState,
} from "../js/admin-utils.js";
import { parseYeongjunMenu } from "../supabase/functions/_shared/yeongjun-parser.js";

const require = createRequire(import.meta.url);
const kakaoMemoHandler = require("../api/kakao-memo.js");

const operationalSettings = {
  breakfastStart: "08:00",
  breakfastEnd: "09:30",
  lunchStart: "11:30",
  lunchEnd: "14:00",
  scanBufferMinutes: 30,
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const createValidMemoRequest = () => ({
  method: "POST",
  headers: { authorization: "Bearer test-token-never-sent-to-real-kakao" },
  body: {
    templateId: 138483,
    templateArgs: {
      time: "중식",
      menuText2: "백미밥·미역국",
      menuText: "제육볶음·배추김치",
      month: "11",
      day: "2",
      image: "https://uupatosmuueifsssdkev.supabase.co/storage/v1/object/public/meal-tray-images/test.png",
    },
  },
});

const menuCell = (value) => `<td><div class="menu-name">${value}</div></td>`;
const menuRow = (className, values) => `<tr class="${className}">${values.map(menuCell).join("")}</tr>`;
const longHtmlPadding = `<!--${"x".repeat(1100)}-->`;

describe("메뉴 문자열 경계값과 예외", () => {
  test("[경계값] 정확히 24글자인 메뉴명은 허용한다", () => {
    // 제한값 자체는 정상 범위다. '24 이상'으로 잘못 구현되는 회귀를 방지한다.
    const menuAtLimit = "가".repeat(24);
    assert.equal(formatKakaoMenuText([menuAtLimit]), menuAtLimit);
  });

  test("[경계값+예외] 제한보다 한 글자 많은 25글자 메뉴명은 명확히 거부한다", () => {
    // 음식명 중간을 강제로 자르면 의미가 훼손되므로 줄바꿈 대신 검증 오류가 나야 한다.
    const menuOverLimit = "가".repeat(25);
    assert.throws(
      () => formatKakaoMenuText([menuOverLimit]),
      /메뉴명이 24글자를 초과합니다/,
    );
  });

  test("[엣지 케이스] null·빈 문자열은 제외하고 내부 중복 공백은 하나로 정리한다", () => {
    // 크롤링 데이터에는 null, 공백 전용 셀, 연속 공백이 섞일 수 있다.
    assert.equal(
      formatKakaoMenuText([null, "  ", "  소고기   미역국  ", undefined, "배추김치"]),
      "소고기 미역국, 배추김치",
    );
  });

  test("[Unicode 경계값] 결합 문자는 사용자에게 보이는 한 글자로 계산한다", () => {
    // e + 결합 악센트처럼 코드 포인트가 둘이어도 화면상 한 글자면 한 칸으로 계산해야 한다.
    const visibleTwentyFourCharacters = "e\u0301".repeat(24);
    assert.equal(formatKakaoMenuText([visibleTwentyFourCharacters]), visibleTwentyFourCharacters);
  });
});

describe("카카오 식단 카드 입력 검증", () => {
  test("[정상값] 과거 식단도 날짜·식사·이미지 정보를 보존해 공유 인자로 만든다", () => {
    // 공유 대상은 '오늘'로 제한되지 않는다. 지난 식단 공유 실패의 재발을 막는 회귀 테스트다.
    assert.deepEqual(buildKakaoTemplateArgs({
      type: "breakfast",
      date: "2026-07-20",
      items: ["백미밥", "미역국"],
      trayImage: { imageUrl: "https://example.com/history-breakfast.png" },
    }), {
      time: "조식",
      menuText2: "백미밥",
      menuText: "미역국",
      day: "20",
      image: "https://example.com/history-breakfast.png",
      month: "7",
    });
  });

  for (const { label, meal, message } of [
    {
      label: "지원하지 않는 식사 구분",
      meal: { type: "dinner", date: "2026-11-02", items: ["밥"], trayImage: { imageUrl: "https://example.com/a.png" } },
      message: /조식 또는 중식/,
    },
    {
      label: "잘못된 날짜 형식",
      meal: { type: "lunch", date: "2026\/11\/02", items: ["밥"], trayImage: { imageUrl: "https://example.com/a.png" } },
      message: /날짜 형식/,
    },
    {
      label: "HTTPS가 아닌 이미지",
      meal: { type: "lunch", date: "2026-11-02", items: ["밥"], trayImage: { imageUrl: "http://example.com/a.png" } },
      message: /식판 이미지/,
    },
  ]) {
    test(`[파라미터화 예외] ${label} 입력은 전송 전에 차단한다`, () => {
      // 동일한 검증 규칙을 입력 표로 반복해 테스트 중복을 줄인다.
      assert.throws(() => buildKakaoTemplateArgs(meal), message);
    });
  }
});

describe("QR 식사 자동 선택의 분 단위 경계", () => {
  for (const { time, expected, reason } of [
    { time: "2026-10-20T22:30:00Z", expected: "breakfast", reason: "조식 시작 30분 전(07:30 KST)은 포함" },
    { time: "2026-10-21T01:59:00Z", expected: "breakfast", reason: "중식 허용 시작 1분 전(10:59 KST)은 아직 조식 기본값" },
    { time: "2026-10-21T02:00:00Z", expected: "lunch", reason: "중식 시작 30분 전(11:00 KST)은 포함" },
    { time: "2026-10-21T05:30:00Z", expected: "lunch", reason: "중식 종료 30분 후(14:30 KST)는 포함" },
  ]) {
    test(`[파라미터화 경계값] ${reason}`, () => {
      assert.equal(getAutomaticMealType(new Date(time), operationalSettings), expected);
    });
  }
});

describe("관리자 수동 식단 등록 예외", () => {
  test("[예외] 제공 상태인데 유효한 메뉴가 하나도 없으면 저장하지 않는다", () => {
    // 운영 중인 빈 식단은 사용자 화면을 혼란스럽게 하므로 관리자에게 즉시 오류를 알려야 한다.
    assert.throws(
      () => getManualMealState("provided", ["", "   ", null]),
      /제공 식단의 메뉴를 입력해주세요/,
    );
  });

  test("[엣지 케이스] 휴무 사유가 비어 있으면 안전한 기본 사유를 사용한다", () => {
    assert.deepEqual(getManualMealState("closed", ["잘못 들어온 메뉴"], "  "), {
      menuItems: [],
      isOperating: false,
      adminNote: "휴무일",
    });
  });
});

describe("원본 식단 HTML 파서의 방어 로직", () => {
  test("[예외] 지나치게 짧은 응답은 정상 식단으로 오인하지 않는다", () => {
    // 로그인 만료 페이지나 서버 오류 문구를 메뉴로 저장하는 사고를 방지한다.
    assert.throws(
      () => parseYeongjunMenu("<html>로그인이 필요합니다.</html>"),
      /본문이 비어 있거나 너무 짧습니다/,
    );
  });

  test("[예외] 평일 날짜가 연속되지 않으면 잘못된 주간표로 판단한다", () => {
    // 11월 3일 다음에 11월 5일이 오도록 구성해 누락된 날짜 검증을 확인한다.
    const headers = ["11-02(Mon)", "11-03(Tue)", "11-05(Thu)", "11-06(Fri)", "11-07(Sat)"];
    const html = `${longHtmlPadding}<table><thead><tr>${headers.map((value) => `<th>${value}</th>`).join("")}</tr></thead><tbody>
      ${menuRow("breakfast-row", ["밥", "밥", "밥", "밥", "밥"])}
      ${menuRow("lunch-row", ["국", "국", "국", "국", "국"])}
    </tbody></table>`;

    assert.throws(
      () => parseYeongjunMenu(html, new Date("2026-11-02T00:00:00Z")),
      /연속된 평일이 아닙니다/,
    );
  });
});

describe("카카오 외부 API Mock", () => {
  test("[Mock 정상값] 실제 네트워크 없이 올바른 템플릿 요청만 전송하는지 검증한다", async () => {
    // 과제 실행 중 실제 카카오톡이 발송되지 않도록 global.fetch를 가짜 응답으로 교체한다.
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ result_code: 0 }), { status: 200 });
    };

    try {
      const response = createResponse();
      await kakaoMemoHandler(createValidMemoRequest(), response);

      assert.equal(response.statusCode, 200);
      assert.equal(calls.length, 1, "중복 발송을 막기 위해 외부 호출은 정확히 한 번이어야 한다.");
      assert.equal(calls[0].url, "https://kapi.kakao.com/v2/api/talk/memo/send");
      assert.equal(calls[0].options.body.get("template_id"), "138483");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("[Mock 보안 예외] 허용되지 않은 이미지 호스트는 외부 API 호출 전에 거부한다", async () => {
    // 검증 실패 요청이 카카오 서버까지 전달되지 않는다는 점도 함께 확인한다.
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      throw new Error("호출되면 안 됨");
    };

    try {
      const request = createValidMemoRequest();
      request.body.templateArgs.image = "https://attacker.example/tray.png";
      const response = createResponse();
      await kakaoMemoHandler(request, response);

      assert.equal(response.statusCode, 400);
      assert.equal(fetchCalled, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
