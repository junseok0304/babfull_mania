const MAX_LINE_LENGTH = 24;
const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

const graphemeLength = (value) => [...segmenter.segment(value)].length;

export const formatKakaoMenuText = (items) => {
  const menus = items
    .map((item) => String(item ?? "").trim().replace(/\s+/g, " "))
    .filter(Boolean);
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

  return {
    time: meal.type === "breakfast" ? "조식" : "중식",
    menuText: formatKakaoMenuText(meal.items),
    day: String(Number(day)),
    image,
    month: String(Number(month)),
  };
};
