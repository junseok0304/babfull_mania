const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/config.js");

const createResponse = () => {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    headers,
  };
};

test("공개 Supabase 설정만 반환한다", () => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "public-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "must-not-leak";
  const response = createResponse();

  handler({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    supabaseUrl: "https://project.supabase.co",
    supabaseAnonKey: "public-anon-key",
  });
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"), false);
  assert.equal(response.headers["Cache-Control"], "no-store, max-age=0");
});

test("설정이 없으면 서비스 준비 전 상태를 반환한다", () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  const response = createResponse();

  handler({}, response);

  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /not available/i);
});
