const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repositoryRoot = join(__dirname, "..");

test("README가 처음 사용하는 사람에게 필요한 실행·설정·검증 절차를 안내한다", () => {
  const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");

  // 프로젝트 소개만 있고 실행 절차가 빠지는 회귀를 막기 위한 문서 요구사항 검사다.
  for (const requiredText of [
    "## 주요 기능",
    "## 로컬에서 실행하기",
    "## 환경변수와 외부 서비스 연결",
    "## 테스트",
    "## 기본 사용법",
    "npm run test:all",
    "http://localhost:4173/?demo=1#home",
  ]) {
    assert.ok(readme.includes(requiredText), `README에 '${requiredText}' 안내가 필요합니다.`);
  }
});
