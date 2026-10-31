const test = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../api/kakao-memo.js");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const validRequest = () => ({
  method: "POST",
  headers: { authorization: "Bearer kakao-provider-token" },
  body: {
    templateId: 138483,
    templateArgs: {
      time: "조식",
      menuText2: "백미밥",
      menuText: "미역국",
      day: "30",
      image: "https://uupatosmuueifsssdkev.supabase.co/storage/v1/object/public/meal-tray-images/sample.png",
      month: "10",
    },
  },
});

test("검증된 여섯 인자를 카카오 나에게 보내기 API로 전달한다", async () => {
  const originalFetch = global.fetch;
  let sentForm;
  global.fetch = async (_url, options) => {
    sentForm = options.body;
    return new Response(JSON.stringify({ result_code: 0 }), { status: 200 });
  };
  try {
    const response = createResponse();
    await handler(validRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(sentForm.get("template_id"), "138483");
    assert.deepEqual(JSON.parse(sentForm.get("template_args")), validRequest().body.templateArgs);
  } finally {
    global.fetch = originalFetch;
  }
});

test("허용하지 않은 외부 이미지 호스트는 거부한다", async () => {
  const request = validRequest();
  request.body.templateArgs.image = "https://example.com/not-allowed.png";
  const response = createResponse();
  await handler(request, response);
  assert.equal(response.statusCode, 400);
});

test("카카오 제공자 토큰이 없으면 재인증 응답을 반환한다", async () => {
  const request = validRequest();
  request.headers = {};
  const response = createResponse();
  await handler(request, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.reauthRequired, true);
});
