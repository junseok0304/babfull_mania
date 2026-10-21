const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/admin-denied.js");

test("관리자 접근 거부 응답은 HTTP 400을 반환한다", () => {
  const headers = {};
  const response = {
    statusCode: 200,
    body: "",
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
  };

  handler({}, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /활성 관리자 계정/);
  assert.equal(headers["Cache-Control"], "no-store, max-age=0");
});
