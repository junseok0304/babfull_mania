/**
 * 식단 원본 HTML을 외부 DOM 라이브러리 없이 제한된 표 구조로 해석합니다.
 * 평일 5일의 연속성까지 검증해 오류 페이지나 오래된 표가 운영 DB에 저장되는 것을 막습니다.
 */
const decodeEntities = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll("&nbsp;", " ")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'");

const cleanText = (value) => decodeEntities(String(value ?? "")
  .replace(/<br\s*\/?\s*>/gi, " ")
  .replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

const blocks = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
  .map((match) => ({ html: match[0], inner: match[1] }));

const hasClass = (html, className) => {
  const classValue = html.match(/class\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
  return classValue.split(/\s+/).includes(className);
};

const extractMenuText = (cellHtml) => {
  const menu = cellHtml.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bmenu-name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const text = cleanText(menu?.[1] ?? cellHtml)
    .replace(/(?:👍|👎)\s*\d*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "*" || text === "/" || /^\d+$/.test(text)) return "";
  if (/\[천원의아침밥\].*운영시간/u.test(text)) return "";
  return text;
};

const formatDate = (date) => date.toISOString().slice(0, 10);
const utcDate = (year, month, day) => new Date(Date.UTC(year, month - 1, day));

export const resolveExpectedImportMonday = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const seoulDate = utcDate(Number(values.year), Number(values.month), Number(values.day));
  const day = seoulDate.getUTCDay();

  // 일요일 21시 사전 수집은 다음 날부터 시작하는 새 주차를 대상으로 한다.
  seoulDate.setUTCDate(seoulDate.getUTCDate() + (day === 0 ? 1 : -((day + 6) % 7)));
  return formatDate(seoulDate);
};

const resolveDates = (headers, now) => {
  const monthDays = headers.map((header) => {
    const match = header.match(/(\d{1,2})\s*[-./]\s*(\d{1,2})/);
    if (!match) throw new Error(`날짜 헤더를 해석할 수 없습니다: ${header}`);
    return { month: Number(match[1]), day: Number(match[2]) };
  });
  const today = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  const candidates = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1]
    .map((year) => ({ year, distance: Math.abs(utcDate(year, monthDays[0].month, monthDays[0].day) - today) }))
    .sort((a, b) => a.distance - b.distance);
  let year = candidates[0].year;
  const dates = monthDays.map((value, index) => {
    if (index && value.month < monthDays[index - 1].month) year += 1;
    return utcDate(year, value.month, value.day);
  });
  dates.forEach((date, index) => {
    if (index && (date - dates[index - 1]) / 86400000 !== 1) throw new Error("식단 날짜가 연속된 평일이 아닙니다.");
    if (date.getUTCDay() < 1 || date.getUTCDay() > 5) throw new Error("식단 날짜에 주말이 포함되어 있습니다.");
  });
  return dates.map(formatDate);
};

const parseSection = (tableHtml, className) => {
  const result = Array.from({ length: 5 }, () => []);
  blocks(tableHtml, "tr").filter((row) => hasClass(row.html, className)).forEach((row) => {
    blocks(row.inner, "t[dh]").slice(0, 5).forEach((cell, index) => {
      const value = extractMenuText(cell.inner);
      if (value) result[index].push(value);
    });
  });
  return result;
};

const closedPattern = /(휴무|미운영|미제공|연휴)/u;

export const parseYeongjunMenu = (html, now = new Date()) => {
  if (typeof html !== "string" || html.length < 1000) throw new Error("원본 식단 HTML 본문이 비어 있거나 너무 짧습니다.");
  const tables = blocks(html, "table");
  const table = tables.find((candidate) => /breakfast-row|lunch-row/.test(candidate.html));
  if (!table) throw new Error("조식·중식 식단 테이블을 찾지 못했습니다.");
  const thead = blocks(table.inner, "thead")[0];
  if (!thead) throw new Error("식단 날짜 헤더를 찾지 못했습니다.");
  const headers = blocks(thead.inner, "t[dh]").slice(0, 5).map((cell) => cleanText(cell.inner));
  if (headers.length !== 5 || headers.some((header) => !header)) throw new Error("평일 날짜 헤더 5개를 찾지 못했습니다.");
  const dates = resolveDates(headers, now);
  const breakfast = parseSection(table.html, "breakfast-row");
  const lunch = parseSection(table.html, "lunch-row");
  if (!breakfast.some((items) => items.length) && !lunch.some((items) => items.length)) throw new Error("조식·중식 메뉴를 모두 찾지 못했습니다.");

  const meals = dates.flatMap((date, index) => [
    { date, type: "breakfast", rawItems: breakfast[index] },
    { date, type: "lunch", rawItems: lunch[index] },
  ]).map(({ date, type, rawItems }) => {
    const closure = rawItems.find((item) => closedPattern.test(item));
    return {
      date,
      type,
      items: closure ? rawItems.filter((item) => item !== closure) : rawItems,
      operating: !closure && rawItems.length > 0,
      note: closure || (rawItems.length ? null : "미제공"),
    };
  });
  return { headers, dates, meals };
};
