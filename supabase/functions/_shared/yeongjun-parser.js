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

// 원본 식단표에는 간혹 음식명이 아닌 절기·세시풍속 안내가 한 칸을 차지한다.
// 완전히 같은 안내 문구만 제외하여, "동지팥죽"처럼 절기명이 포함된 실제 메뉴는 보존한다.
const calendarMarkerPairs = [
  ["입춘", "立春"], ["우수", "雨水"], ["경칩", "驚蟄"], ["춘분", "春分"],
  ["청명", "清明"], ["곡우", "穀雨"], ["입하", "立夏"], ["소만", "小滿"],
  ["망종", "芒種"], ["하지", "夏至"], ["소서", "小暑"], ["대서", "大暑"],
  ["입추", "立秋"], ["처서", "處暑"], ["백로", "白露"], ["추분", "秋分"],
  ["한로", "寒露"], ["상강", "霜降"], ["입동", "立冬"], ["소설", "小雪"],
  ["대설", "大雪"], ["동지", "冬至"], ["소한", "小寒"], ["대한", "大寒"],
  // 칠석은 24절기는 아니지만 원본 표에서 같은 형태의 달력 안내로 사용된다.
  ["칠석", "七夕"],
];

const normalizeCalendarMarker = (value) => String(value ?? "")
  .replace(/[\s()[\]{}·:：-]/gu, "")
  .toLocaleLowerCase("ko-KR");

const calendarMarkers = new Set(calendarMarkerPairs.flatMap(([korean, hanja]) => [
  korean, hanja, `${korean}${hanja}`, `${hanja}${korean}`,
]).map(normalizeCalendarMarker));

export const isCalendarMenuMarker = (value) => calendarMarkers.has(normalizeCalendarMarker(value));

const extractMenuText = (cellHtml) => {
  const menu = cellHtml.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bmenu-name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const text = cleanText(menu?.[1] ?? cellHtml)
    .replace(/(?:👍|👎)\s*\d*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "*" || text === "/" || /^\d+$/.test(text)) return "";
  if (/\[천원의아침밥\].*운영시간/u.test(text)) return "";
  if (isCalendarMenuMarker(text)) return "";
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
