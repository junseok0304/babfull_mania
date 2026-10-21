const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const getSeoulDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
};

const menuSets = [
  {
    breakfast: ["백미밥", "미역국", "계란말이", "도시락김", "배추김치"],
    lunch: ["백미밥", "팽이버섯된장국", "수제돈가스", "오이무침", "무말랭이무침", "깍두기", "양배추샐러드"],
  },
  {
    breakfast: ["잡곡밥", "콩나물국", "소시지볶음", "연근조림", "배추김치"],
    lunch: ["백미밥", "김치찌개", "제육볶음", "상추겉절이", "콩나물무침", "깍두기"],
  },
  {
    breakfast: ["백미밥", "어묵국", "두부조림", "멸치볶음", "배추김치"],
    lunch: ["흑미밥", "순두부찌개", "닭갈비", "감자채볶음", "시금치무침", "배추김치"],
  },
  {
    breakfast: ["잡곡밥", "북엇국", "고기산적", "무생채", "배추김치"],
    lunch: ["백미밥", "유부장국", "생선가스", "떡볶이", "단무지", "양배추샐러드"],
  },
  {
    breakfast: ["백미밥", "된장국", "스크램블에그", "진미채볶음", "깍두기"],
    lunch: ["잡곡밥", "육개장", "간장불고기", "청포묵무침", "애호박볶음", "배추김치"],
  },
];

const today = getSeoulDate();
const monday = addDays(today, -((today.getDay() + 6) % 7));

export const appSettings = {
  breakfastStart: "08:00",
  breakfastEnd: "09:30",
  lunchStart: "11:30",
  lunchEnd: "14:00",
  isPreview: true,
};

export const sampleMeals = menuSets.flatMap((menus, dayIndex) => {
  const date = formatDateKey(addDays(monday, dayIndex));
  return [
    { id: `${date}-breakfast`, date, type: "breakfast", items: menus.breakfast, published: true },
    { id: `${date}-lunch`, date, type: "lunch", items: menus.lunch, published: true },
  ];
});

export { formatDateKey, getSeoulDate };
