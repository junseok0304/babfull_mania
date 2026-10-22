export const defaultOperationalSettings = Object.freeze({
  breakfastStart: "08:00",
  breakfastEnd: "09:30",
  lunchStart: "11:30",
  lunchEnd: "14:00",
  scanBufferMinutes: 30,
  breakfastPrice: 1000,
  lunchPrice: 5300,
  trayDisplayMode: "search",
});

const toMinutes = (value) => {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
};

export const getAutomaticMealType = (now = new Date(), settings = defaultOperationalSettings) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const buffer = Number(settings.scanBufferMinutes ?? 30);
  const breakfastWindow = [toMinutes(settings.breakfastStart) - buffer, toMinutes(settings.breakfastEnd) + buffer];
  const lunchWindow = [toMinutes(settings.lunchStart) - buffer, toMinutes(settings.lunchEnd) + buffer];
  if (minutes >= breakfastWindow[0] && minutes <= breakfastWindow[1]) return "breakfast";
  if (minutes >= lunchWindow[0] && minutes <= lunchWindow[1]) return "lunch";
  return minutes < lunchWindow[0] ? "breakfast" : "lunch";
};

export const getManualMealState = (availability, menuItems = [], closureNote = "") => {
  const items = menuItems.map((item) => String(item).trim()).filter(Boolean);
  if (availability === "provided") {
    if (!items.length) throw new Error("제공 식단의 메뉴를 입력해주세요.");
    return { menuItems: items, isOperating: true, adminNote: null };
  }
  if (availability === "unavailable") return { menuItems: [], isOperating: false, adminNote: "미제공" };
  if (availability === "closed") return { menuItems: [], isOperating: false, adminNote: String(closureNote).trim() || "휴무일" };
  throw new Error("제공 여부를 선택해주세요.");
};

export const shouldShowClosureReason = (availability) => availability === "closed";

export const buildDashboardSummary = (raw = {}) => {
  const breakfastCount = Number(raw.breakfast_count ?? raw.breakfastCount ?? 0);
  const lunchCount = Number(raw.lunch_count ?? raw.lunchCount ?? 0);
  const mealTotal = breakfastCount + lunchCount;
  return {
    totalMembers: Number(raw.total_members ?? raw.totalMembers ?? 0),
    todayUsageCount: Number(raw.today_usage_count ?? raw.todayUsageCount ?? 0),
    monthUsageCount: Number(raw.month_usage_count ?? raw.monthUsageCount ?? 0),
    monthRevenue: Number(raw.month_revenue ?? raw.monthRevenue ?? 0),
    breakfastCount,
    lunchCount,
    breakfastPercent: mealTotal ? Math.round((breakfastCount / mealTotal) * 100) : 0,
    lunchPercent: mealTotal ? Math.round((lunchCount / mealTotal) * 100) : 0,
    affiliations: Array.isArray(raw.affiliations) ? raw.affiliations.map((item) => ({
      affiliation: item.affiliation || "소속 미등록",
      count: Number(item.count || 0),
    })) : [],
  };
};
