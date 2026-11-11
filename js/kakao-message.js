/**
 * 식단 데이터를 카카오 커스텀 템플릿 인자로 변환합니다.
 * 메뉴명은 중간에서 자르지 않고 사용자에게 보이는 Unicode 글자 단위로 24자 제한을 검증합니다.
 */
const MAX_LINE_LENGTH = 24;
const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ko", { granularity: "grapheme" })
  : null;

const graphemeLength = (value) => segmenter
  ? [...segmenter.segment(value)].length
  : Array.from(value).length;

const normalizeMenus = (items) => items
  .map((item) => String(item ?? "").trim().replace(/\s+/g, " "))
  .filter(Boolean);

export const formatKakaoMenuText = (items) => {
  const menus = normalizeMenus(items);
  if (!menus.length) throw new Error("공유할 메뉴가 없습니다.");

  const lines = [];
  let currentLine = "";
  menus.forEach((menu) => {
    if (graphemeLength(menu) > MAX_LINE_LENGTH) {
      throw new Error(`메뉴명이 24글자를 초과합니다: ${menu}`);
    }
    const candidate = currentLine ? `${currentLine}, ${menu}` : menu;
    if (graphemeLength(candidate) <= MAX_LINE_LENGTH) currentLine = candidate;
    else {
      lines.push(currentLine);
      currentLine = menu;
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
};

export const formatKakaoMenuVariables = (items) => {
  // 템플릿의 두 본문 변수에 모든 메뉴가 유지되도록 완성된 줄 단위로 균형 분배합니다.
  const menus = normalizeMenus(items);
  if (!menus.length) throw new Error("공유할 메뉴가 없습니다.");
  if (menus.length === 1) return { menuText2: menus[0], menuText: "" };

  let best = null;
  for (let split = 1; split < menus.length; split += 1) {
    const menuText2 = menus.slice(0, split).join("·");
    const menuText = menus.slice(split).join("·");
    const firstLength = graphemeLength(menuText2);
    const secondLength = graphemeLength(menuText);
    const score = Math.max(firstLength, secondLength) * 100 + Math.abs(firstLength - secondLength);
    if (!best || score < best.score) best = { menuText2, menuText, score };
  }
  return { menuText2: best.menuText2, menuText: best.menuText };
};

export const buildKakaoTemplateArgs = (meal) => {
  if (!meal || !["breakfast", "lunch"].includes(meal.type)) {
    throw new Error("조식 또는 중식 식단만 공유할 수 있습니다.");
  }
  const image = meal.trayImage?.imageUrl;
  if (!image || !/^https:\/\//i.test(image)) {
    throw new Error("공유할 식판 이미지가 아직 준비되지 않았습니다.");
  }
  const [, month, day] = String(meal.date).match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
  if (!month || !day) throw new Error("식단 날짜 형식이 올바르지 않습니다.");

  const menuVariables = formatKakaoMenuVariables(meal.items);
  return {
    time: meal.type === "breakfast" ? "조식" : "중식",
    menuText2: menuVariables.menuText2,
    menuText: menuVariables.menuText,
    day: String(Number(day)),
    image,
    month: String(Number(month)),
  };
};
