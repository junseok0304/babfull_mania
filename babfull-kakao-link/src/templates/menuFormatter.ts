const MAX_MENU_LINE_LENGTH = 24;
const graphemeSegmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

export class MenuFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuFormatError";
  }
}

export function charLength(text: string): number {
  return Array.from(graphemeSegmenter.segment(text)).length;
}

export function formatMenuText(
  menuItems: readonly string[],
  maxLength = MAX_MENU_LINE_LENGTH,
): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new MenuFormatError("줄 길이 제한은 1 이상의 정수여야 합니다.");
  }

  const menus = menuItems
    .map((item) => item.trim().replace(/\s+/gu, " "))
    .filter(Boolean);

  if (menus.length === 0) {
    throw new MenuFormatError("메뉴 데이터가 없습니다.");
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const menu of menus) {
    if (charLength(menu) > maxLength) {
      throw new MenuFormatError(`메뉴명이 ${maxLength}글자를 초과합니다: ${menu}`);
    }

    const candidate = currentLine ? `${currentLine}, ${menu}` : menu;
    if (charLength(candidate) <= maxLength) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) lines.push(currentLine);
    currentLine = menu;
  }

  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
}

export function formatMenuTemplateVariables(menuItems: readonly string[]): {
  menuText2: string;
  menuText: string;
} {
  const menus = menuItems
    .map((item) => item.trim().replace(/\s+/gu, " "))
    .filter(Boolean);
  if (menus.length === 0) throw new MenuFormatError("메뉴 데이터가 없습니다.");
  if (menus.length === 1) return { menuText2: menus[0]!, menuText: "" };

  let best: { menuText2: string; menuText: string; score: number } | null = null;
  for (let split = 1; split < menus.length; split += 1) {
    const menuText2 = menus.slice(0, split).join("·");
    const menuText = menus.slice(split).join("·");
    const firstLength = charLength(menuText2);
    const secondLength = charLength(menuText);
    const score = Math.max(firstLength, secondLength) * 100 + Math.abs(firstLength - secondLength);
    if (!best || score < best.score) best = { menuText2, menuText, score };
  }
  return { menuText2: best!.menuText2, menuText: best!.menuText };
}

export { MAX_MENU_LINE_LENGTH };
