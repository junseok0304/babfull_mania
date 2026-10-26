const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("주간 식단 수집은 월요일 오전 8시 이후에 실행한다", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/202610260001_reschedule_weekly_import.sql"), "utf8");
  assert.match(migration, /'30 23 \* \* 0'/);
  assert.match(migration, /월요일 08:30/);
});
