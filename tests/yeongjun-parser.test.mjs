import test from "node:test";
import assert from "node:assert/strict";
import { parseYeongjunMenu, resolveExpectedImportMonday } from "../supabase/functions/_shared/yeongjun-parser.js";

const cell = (value) => `<td><div class="menu-name">${value}</div></td>`;
const row = (className, values) => `<tr class="${className}">${values.map(cell).join("")}</tr>`;
const padding = "<!--" + "x".repeat(1100) + "-->";

test("평일 조식·중식과 휴무 상태를 파싱한다", () => {
  const html = `${padding}<table><thead><tr>${["10-19(Mon)", "10-20(Tue)", "10-21(Wed)", "10-22(Thu)", "10-23(Fri)"].map((value) => `<th>${value}</th>`).join("")}</tr></thead><tbody>
    ${row("breakfast-row", ["[천원의아침밥] 운영시간 8:00~9:00", "", "", "", ""])}
    ${row("breakfast-row", ["백미밥", "잡곡밥", "흑미밥", "문화체험 휴무", ""])}
    ${row("lunch-row", ["콩나물국", "미역국", "두부&amp;김치볶음", "", "육개장"])}
  </tbody></table>`;
  const result = parseYeongjunMenu(html, new Date("2026-10-21T00:00:00Z"));
  assert.deepEqual(result.dates, ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  assert.deepEqual(result.meals[0].items, ["백미밥"]);
  assert.deepEqual(result.meals[5].items, ["두부&김치볶음"]);
  assert.deepEqual(result.meals[6], { date: "2026-10-22", type: "breakfast", items: [], operating: false, note: "문화체험 휴무" });
});

test("연말과 연초 사이의 연도를 올바르게 결정한다", () => {
  const headers = ["12-29(Mon)", "12-30(Tue)", "12-31(Wed)", "01-01(Thu)", "01-02(Fri)"];
  const html = `${padding}<table><thead><tr>${headers.map((value) => `<th>${value}</th>`).join("")}</tr></thead><tbody>
    ${row("breakfast-row", ["밥", "밥", "밥", "밥", "밥"])}
    ${row("lunch-row", ["국", "국", "국", "국", "국"])}
  </tbody></table>`;
  const result = parseYeongjunMenu(html, new Date("2025-12-31T00:00:00Z"));
  assert.deepEqual(result.dates, ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
});

test("일요일에는 다음 날 월요일을 식단 수집 대상 주차로 선택한다", () => {
  assert.equal(resolveExpectedImportMonday(new Date("2026-11-01T12:00:00Z")), "2026-11-02");
  assert.equal(resolveExpectedImportMonday(new Date("2026-11-02T00:00:00Z")), "2026-11-02");
});
