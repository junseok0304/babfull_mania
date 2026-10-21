import { formatDateKey, getSeoulDate, sampleMeals } from "./sample-data.js";

const mealLabels = { breakfast: "조식", lunch: "중식" };
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
let weekOffset = 0;
let displayedMonth = new Date(getSeoulDate().getFullYear(), getSeoulDate().getMonth(), 1);
let selectedDate = formatDateKey(getSeoulDate());

const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const getMonday = (date) => addDays(date, -((date.getDay() + 6) % 7));
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const mealsForDate = (dateKey) => sampleMeals.filter((meal) => meal.date === dateKey && meal.published);

const dateLabel = (date) => new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
}).format(date);

const renderWeekly = () => {
  const today = getSeoulDate();
  const monday = addDays(getMonday(today), weekOffset * 7);
  const sunday = addDays(monday, 6);
  const todayKey = formatDateKey(today);
  document.querySelector("#week-label").textContent = `${dateLabel(monday)} – ${dateLabel(sunday)}`;

  document.querySelector("#weekly-grid").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    const key = formatDateKey(date);
    const meals = mealsForDate(key);
    const mealContent = meals.length
      ? meals.map((meal) => `<dl class="day-card__meal"><dt>${mealLabels[meal.type]}</dt><dd>${meal.items.map(escapeHtml).join(" · ")}</dd></dl>`).join("")
      : '<p class="day-card__empty">등록된 식단이 없어요.</p>';
    return `<article class="day-card${key === todayKey ? " is-today" : ""}">
      <header class="day-card__header"><div class="day-card__date"><strong>${date.getDate()}</strong><span>${weekdays[date.getDay()]}요일</span></div>${key === todayKey ? '<span class="current-badge">오늘</span>' : ""}</header>
      ${mealContent}
    </article>`;
  }).join("");
};

const renderSelectedDay = () => {
  const meals = mealsForDate(selectedDate);
  const target = document.querySelector("#selected-day");
  if (!meals.length) {
    target.innerHTML = `<h2>${selectedDate}</h2><p class="selected-day__empty">등록된 식단이 없습니다.</p>`;
    return;
  }
  target.innerHTML = `<h2>${selectedDate} 식단</h2>${meals.map((meal) =>
    `<div class="selected-day__meal"><strong>${mealLabels[meal.type]}</strong><span>${meal.items.map(escapeHtml).join(" · ")}</span></div>`
  ).join("")}`;
};

const renderCalendar = () => {
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();
  const todayKey = formatDateKey(getSeoulDate());
  const first = new Date(year, month, 1);
  const gridStart = addDays(first, -first.getDay());
  document.querySelector("#month-label").textContent = `${year}년 ${month + 1}월`;

  document.querySelector("#calendar-grid").innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const key = formatDateKey(date);
    const meals = mealsForDate(key);
    const preview = meals.flatMap((meal) => meal.items.slice(0, 2)).join(" · ");
    return `<button class="calendar-day${date.getMonth() !== month ? " is-outside" : ""}${key === todayKey ? " is-today" : ""}${key === selectedDate ? " is-selected" : ""}" type="button" data-date="${key}" aria-label="${key}${meals.length ? `, 식단 ${meals.length}개` : ", 식단 없음"}">
      <span class="calendar-day__number">${date.getDate()}</span>
      ${preview ? `<span class="calendar-day__preview">${escapeHtml(preview)}</span>` : ""}
      ${meals.length ? `<span class="calendar-day__dots" aria-hidden="true">${meals.map(() => "<i></i>").join("")}</span>` : ""}
    </button>`;
  }).join("");

  document.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDate = button.dataset.date;
      const selected = new Date(`${selectedDate}T00:00:00`);
      if (selected.getMonth() !== displayedMonth.getMonth()) displayedMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
      renderCalendar();
      renderSelectedDay();
    });
  });
  renderSelectedDay();
};

const normalizeSearch = (value) => value.toLocaleLowerCase("ko-KR").replaceAll(/\s+/g, "").replaceAll("까스", "가스");

const renderSearch = (query) => {
  const normalized = normalizeSearch(query.trim());
  const summary = document.querySelector("#search-summary");
  const results = document.querySelector("#search-results");
  if (!normalized) {
    summary.textContent = "메뉴명을 입력하면 제공된 날짜를 찾아드려요.";
    results.innerHTML = "";
    return;
  }

  const matched = sampleMeals
    .filter((meal) => meal.items.some((item) => normalizeSearch(item).includes(normalized)))
    .sort((a, b) => b.date.localeCompare(a.date));
  summary.textContent = matched.length ? `총 ${matched.length}개의 식단을 찾았어요.` : "검색 결과가 없습니다.";
  results.innerHTML = matched.map((meal) => `<a class="search-result" href="#calendar" data-result-date="${meal.date}">
    <div><strong>${meal.date} · ${mealLabels[meal.type]}</strong><p>${meal.items.map(escapeHtml).join(" · ")}</p></div>
    <span>${mealLabels[meal.type]}</span>
  </a>`).join("");

  document.querySelectorAll("[data-result-date]").forEach((link) => link.addEventListener("click", () => {
    selectedDate = link.dataset.resultDate;
    const selected = new Date(`${selectedDate}T00:00:00`);
    displayedMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    renderCalendar();
  }));
};

export const initPublicViews = () => {
  document.querySelector("#week-prev").addEventListener("click", () => { weekOffset -= 1; renderWeekly(); });
  document.querySelector("#week-next").addEventListener("click", () => { weekOffset += 1; renderWeekly(); });
  document.querySelector("#week-today").addEventListener("click", () => { weekOffset = 0; renderWeekly(); });
  document.querySelector("#month-prev").addEventListener("click", () => { displayedMonth.setMonth(displayedMonth.getMonth() - 1); renderCalendar(); });
  document.querySelector("#month-next").addEventListener("click", () => { displayedMonth.setMonth(displayedMonth.getMonth() + 1); renderCalendar(); });
  document.querySelector("#month-today").addEventListener("click", () => {
    const today = getSeoulDate();
    displayedMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDate = formatDateKey(today);
    renderCalendar();
  });

  const searchInput = document.querySelector("#menu-search");
  document.querySelector("#menu-search-form").addEventListener("submit", (event) => event.preventDefault());
  searchInput.addEventListener("input", () => renderSearch(searchInput.value));
  document.querySelector("#menu-search-form").addEventListener("reset", () => window.setTimeout(() => renderSearch(""), 0));

  renderWeekly();
  renderCalendar();
};
