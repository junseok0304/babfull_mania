import { formatDateKey, getSeoulDate } from "./sample-data.js";
import { getCachedMeals } from "./data-service.js";
import { getMealNutrition, hydrateMealNutrition } from "./nutrition-service.js";

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

const mealsForDate = (dateKey) => getCachedMeals().filter((meal) => meal.date === dateKey && meal.published);
let weeklyRenderId = 0;
let selectedDayRenderId = 0;
let searchRenderId = 0;

const getDayStatus = (date, meals = mealsForDate(formatDateKey(date))) => {
  const operatingMeals = meals.filter((meal) => meal.operating !== false);
  const closedMeal = meals.find((meal) => meal.operating === false);
  if (!operatingMeals.length && closedMeal) return { kind: "closed", label: closedMeal.note || "휴무일" };
  if (!operatingMeals.length) return { kind: date.getDay() === 0 || date.getDay() === 6 ? "closed" : "empty", label: date.getDay() === 0 || date.getDay() === 6 ? "휴무일" : "미제공" };
  if (!operatingMeals.some((meal) => meal.type === "breakfast") && operatingMeals.some((meal) => meal.type === "lunch")) {
    return { kind: "partial", label: "조식 미제공" };
  }
  return null;
};

const dateLabel = (date) => new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
}).format(date);

const renderCalorie = (meal) => {
  const estimate = getMealNutrition(meal);
  if (!estimate.totalCalories) return "";
  const source = estimate.source === "mfds" ? "식약처 식품영양성분 DB"
    : estimate.source === "mfds-mixed" ? "식약처 DB 및 메뉴 유형별 표준치" : "로컬 시연 데이터";
  const detail = `${source} 1회 제공량 기준 · ${estimate.matchedItems}/${estimate.totalItems}개 메뉴 반영`;
  return `<span class="calorie-badge" title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}">약 ${Math.round(estimate.totalCalories).toLocaleString("ko-KR")} kcal</span>`;
};

const renderWeekly = async () => {
  const renderId = ++weeklyRenderId;
  const today = getSeoulDate();
  const monday = addDays(getMonday(today), weekOffset * 7);
  const friday = addDays(monday, 4);
  const todayKey = formatDateKey(today);
  document.querySelector("#week-label").textContent = `${dateLabel(monday)} – ${dateLabel(friday)} · 월–금`;

  const weekMeals = Array.from({ length: 5 }, (_, index) => mealsForDate(formatDateKey(addDays(monday, index))))
    .flat()
    .filter((meal) => meal.operating !== false);
  await hydrateMealNutrition(weekMeals);
  if (renderId !== weeklyRenderId) return;

  document.querySelector("#weekly-grid").innerHTML = Array.from({ length: 5 }, (_, index) => {
    const date = addDays(monday, index);
    const key = formatDateKey(date);
    const allMeals = mealsForDate(key);
    const meals = allMeals.filter((meal) => meal.operating !== false);
    const status = getDayStatus(date, allMeals);
    const statusContent = status ? `<p class="day-card__status day-card__status--${status.kind}">${escapeHtml(status.label)}</p>` : "";
    const mealContent = meals.length
      ? meals.map((meal) => `<dl class="day-card__meal day-card__meal--${meal.type}"><dt><span>${mealLabels[meal.type]}</span>${renderCalorie(meal)}</dt><dd>${meal.items.map(escapeHtml).join(" · ")}</dd></dl>`).join("")
      : `<p class="day-card__empty">${status?.kind === "closed" ? "식당을 운영하지 않아요." : "등록된 식단이 없어요."}</p>`;
    return `<article class="day-card${key === todayKey ? " is-today" : ""}">
      <header class="day-card__header"><div class="day-card__date"><strong>${date.getDate()}</strong><span>${weekdays[date.getDay()]}요일</span></div>${key === todayKey ? '<span class="current-badge">오늘</span>' : ""}</header>
      ${statusContent}${mealContent}
    </article>`;
  }).join("");
};

const renderSelectedDay = async () => {
  const renderId = ++selectedDayRenderId;
  const allMeals = mealsForDate(selectedDate);
  const meals = allMeals.filter((meal) => meal.operating !== false);
  const target = document.querySelector("#selected-day");
  const date = new Date(`${selectedDate}T00:00:00`);
  const status = getDayStatus(date, allMeals);
  if (!meals.length) {
    target.innerHTML = `<h2>${selectedDate}</h2><p class="selected-day__status selected-day__status--${status?.kind || "empty"}">${escapeHtml(status?.label || "미제공")}</p><p class="selected-day__empty">${status?.kind === "closed" ? "식당을 운영하지 않는 날입니다." : "등록된 식단이 없습니다."}</p>`;
    return;
  }
  await hydrateMealNutrition(meals);
  if (renderId !== selectedDayRenderId) return;
  target.innerHTML = `<h2>${selectedDate} 식단</h2>${status ? `<p class="selected-day__status selected-day__status--${status.kind}">${escapeHtml(status.label)}</p>` : ""}${meals.map((meal) =>
    `<div class="selected-day__meal selected-day__meal--${meal.type}"><div class="selected-day__meal-header"><strong>${mealLabels[meal.type]}</strong>${renderCalorie(meal)}</div><span>${meal.items.map(escapeHtml).join(" · ")}</span></div>`
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
    const allMeals = mealsForDate(key);
    const meals = allMeals.filter((meal) => meal.operating !== false);
    const status = getDayStatus(date, allMeals);
    const preview = meals.flatMap((meal) => meal.items.slice(0, 2)).join(" · ");
    return `<button class="calendar-day${date.getMonth() !== month ? " is-outside" : ""}${key === todayKey ? " is-today" : ""}${key === selectedDate ? " is-selected" : ""}${status && !meals.length ? " has-status" : ""}" type="button" data-date="${key}" aria-label="${key}${meals.length ? `, 식단 ${meals.length}개` : `, ${status?.label || "식단 없음"}`}">
      <span class="calendar-day__number">${date.getDate()}</span>
      ${status ? `<span class="calendar-day__status calendar-day__status--${status.kind}">${escapeHtml(status.label)}</span>` : ""}
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

const highlightSearchMatch = (value, query) => {
  const source = String(value);
  const normalizedQuery = normalizeSearch(query.trim());
  if (!normalizedQuery) return escapeHtml(source);
  let normalizedSource = "";
  const sourceIndexes = [];
  [...source].forEach((character, index) => {
    if (/\s/u.test(character)) return;
    const normalizedCharacter = character.toLocaleLowerCase("ko-KR");
    normalizedSource += normalizedCharacter;
    sourceIndexes.push(index);
  });
  normalizedSource = normalizedSource.replaceAll("까스", "가스");
  const start = normalizedSource.indexOf(normalizedQuery);
  if (start < 0) return escapeHtml(source);
  const end = sourceIndexes[Math.min(start + normalizedQuery.length - 1, sourceIndexes.length - 1)] + 1;
  return `${escapeHtml(source.slice(0, sourceIndexes[start]))}<mark class="search-highlight">${escapeHtml(source.slice(sourceIndexes[start], end))}</mark>${escapeHtml(source.slice(end))}`;
};

const renderSearch = async (query) => {
  const renderId = ++searchRenderId;
  const normalized = normalizeSearch(query.trim());
  const summary = document.querySelector("#search-summary");
  const results = document.querySelector("#search-results");
  if (!normalized) {
    summary.textContent = "메뉴명을 입력하면 제공된 날짜를 찾아드려요.";
    results.innerHTML = "";
    return;
  }

  const matched = getCachedMeals()
    .filter((meal) => meal.items.some((item) => normalizeSearch(item).includes(normalized)))
    .sort((a, b) => b.date.localeCompare(a.date));
  await hydrateMealNutrition(matched);
  if (renderId !== searchRenderId) return;
  summary.textContent = matched.length ? `총 ${matched.length}개의 식단을 찾았어요.` : "검색 결과가 없습니다.";
  results.innerHTML = matched.map((meal) => `<a class="search-result" href="#calendar" data-result-date="${meal.date}">
    <div><strong>${meal.date} · ${mealLabels[meal.type]}</strong><p>${meal.items.map((item) => highlightSearchMatch(item, query)).join(" · ")}</p></div>
    <div class="search-result__meta"><span class="search-result__type">${mealLabels[meal.type]}</span>${renderCalorie(meal)}</div>
  </a>`).join("");

  document.querySelectorAll("[data-result-date]").forEach((link) => link.addEventListener("click", () => {
    selectedDate = link.dataset.resultDate;
    const selected = new Date(`${selectedDate}T00:00:00`);
    displayedMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    renderCalendar();
  }));
};

const renderSearchSuggestions = (searchInput) => {
  const target = document.querySelector("#search-suggestions");
  const menuNames = [...new Set(getCachedMeals().flatMap((meal) => meal.items ?? []))]
    .filter((name) => name && !/^\*+$|운영시간|메뉴가 없습니다|휴무/u.test(name));
  const suggestions = menuNames
    .map((name) => ({ name, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)
    .map(({ name }) => name);
  target.innerHTML = suggestions.length
    ? `<span>추천 검색어</span>${suggestions.map((name) => `<button type="button" data-search-suggestion="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}`
    : "";
  target.querySelectorAll("[data-search-suggestion]").forEach((button) => button.addEventListener("click", () => {
    searchInput.value = button.dataset.searchSuggestion;
    renderSearch(searchInput.value);
    searchInput.focus();
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
  renderSearchSuggestions(searchInput);

  renderWeekly();
  renderCalendar();
};
