import { appSettings, formatDateKey, getSeoulDate } from "./sample-data.js";
import { getCachedMeals } from "./data-service.js";
import { getMealNutrition, hydrateMealNutrition } from "./nutrition-service.js";
import { getFoodImage, hydrateMealImages, markFoodImageFailed } from "./food-image-service.js";

const labels = { breakfast: "조식", lunch: "중식" };
const icons = { breakfast: "🌙", lunch: "☀️" };
const manualOpenState = new Map();
let homeRenderId = 0;

const minutesFromTime = (value) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

const getSeoulMinutes = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Number(values.hour) * 60 + Number(values.minute);
};

const getDefaultState = (meals, nowMinutes) => {
  const breakfast = meals.find((meal) => meal.type === "breakfast");
  const lunch = meals.find((meal) => meal.type === "lunch");
  const breakfastStart = minutesFromTime(appSettings.breakfastStart);
  const breakfastEnd = minutesFromTime(appSettings.breakfastEnd);
  const lunchStart = minutesFromTime(appSettings.lunchStart);
  const lunchEnd = minutesFromTime(appSettings.lunchEnd);

  if (breakfast && nowMinutes >= breakfastStart && nowMinutes < breakfastEnd) {
    return { current: "breakfast", open: new Set(["breakfast", ...(lunch ? ["lunch"] : [])]) };
  }

  if (lunch && nowMinutes >= breakfastEnd && nowMinutes < lunchEnd) {
    return { current: "lunch", open: new Set(["lunch"]) };
  }

  if (nowMinutes < breakfastStart) {
    const first = breakfast ? "breakfast" : "lunch";
    return { current: first, open: new Set(first ? [first] : []) };
  }

  if (!breakfast && lunch && nowMinutes < lunchStart) {
    return { current: "lunch", open: new Set(["lunch"]) };
  }

  return { current: null, open: new Set() };
};

const classifyMenu = (name) => {
  if (/밥$|백미|잡곡|흑미|현미/.test(name)) return "rice";
  if (/국$|탕$|찌개$|육개장|장국/.test(name)) return "soup";
  if (/김치|깍두기|단무지/.test(name)) return "kimchi";
  if (/소스|쌈장|간장$/.test(name)) return "sauce";
  if (/가스|까스|볶음|불고기|갈비|산적|계란말이|두부조림/.test(name)) return "main";
  return "side";
};

export const arrangeTray = (items) => {
  const result = [];
  const remaining = [];

  items.forEach((name) => {
    const category = classifyMenu(name);
    if (category === "rice" && !result.some((item) => item.slot === "rice")) result.push({ name, slot: "rice" });
    else if (category === "soup" && !result.some((item) => item.slot === "soup")) result.push({ name, slot: "soup" });
    else remaining.push({ name, category });
  });

  remaining.sort((a, b) => {
    const order = { main: 0, side: 1, sauce: 2, kimchi: 2 };
    return order[a.category] - order[b.category];
  });

  const condimentIndex = remaining.findIndex(({ category }) => category === "sauce" || category === "kimchi");

  if (remaining.length <= 3) {
    const condiment = condimentIndex >= 0 ? remaining.splice(condimentIndex, 1)[0] : null;
    remaining.forEach((item, index) => result.push({ name: item.name, slot: `side-${index + 1}` }));
    if (condiment) result.push({ name: condiment.name, slot: "side-4" });
    return result;
  }

  const dense = remaining.length > 5;
  const slots = dense
    ? ["side-1-top", "side-1-bottom", "side-2-top", "side-2-bottom", "side-3", "side-4"]
    : ["side-1", "side-2", "side-3", "side-4"];
  const condiment = condimentIndex >= 0 ? remaining.splice(condimentIndex, 1)[0] : null;
  remaining.slice(0, slots.length).forEach((item, index) => result.push({ name: item.name, slot: slots[index] }));
  if (condiment) result.push({ name: condiment.name, slot: "small" });
  return result;
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const trayTemplate = (meal) => {
  const slots = arrangeTray(meal.items)
    .map(({ name, slot }) => {
      const image = getFoodImage(name);
      const imageMarkup = image ? `<img src="${escapeHtml(image.imageUrl || image.fallbackUrl)}"
        data-fallback-src="${escapeHtml(image.fallbackUrl || "")}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : "";
      return `<div class="tray-slot tray-slot--${slot}${image ? " has-image" : ""}" data-food-name="${escapeHtml(name)}">
        ${imageMarkup}<span>${escapeHtml(name)}</span>
      </div>`;
    })
    .join("");
  return `<div class="meal-tray" aria-label="${labels[meal.type]} 메뉴 참고 식판">${slots}</div>
    <p class="tray-caption">메뉴별 음식 사진은 실제 제공 모습과 다를 수 있어요.</p>`;
};

const mealCardTemplate = (meal, state, forceOpen = null) => {
  const manuallySet = manualOpenState.get(meal.id);
  const desktopDefaultOpen = window.matchMedia("(min-width: 960px)").matches;
  const isOpen = forceOpen ?? manuallySet ?? (desktopDefaultOpen || state.open.has(meal.type));
  const isCurrent = state.current === meal.type;
  const time = meal.type === "breakfast"
    ? `${appSettings.breakfastStart}–${appSettings.breakfastEnd}`
    : `${appSettings.lunchStart}–${appSettings.lunchEnd}`;
  const price = meal.type === "breakfast" ? appSettings.breakfastPrice : appSettings.lunchPrice;
  const menuItems = meal.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const nutrition = getMealNutrition(meal);
  const calorie = nutrition.totalCalories
    ? `<span class="calorie-badge" title="식약처 식품영양성분 DB와 메뉴 유형별 표준 배식량을 기준으로 계산한 예상치">약 ${Math.round(nutrition.totalCalories).toLocaleString("ko-KR")} kcal</span>`
    : "";

  return `<article class="meal-card meal-card--${meal.type}${isOpen ? " is-open" : ""}${isCurrent ? " is-current" : ""}" data-meal-id="${meal.id}">
    <button class="meal-card__toggle" type="button" aria-expanded="${isOpen}" aria-controls="body-${meal.id}">
      <span class="meal-card__icon" aria-hidden="true">${icons[meal.type]}</span>
      <span class="meal-card__heading">
        <span class="meal-card__title-row">
          <strong class="meal-card__title">${labels[meal.type]} 식단</strong>
          ${isCurrent ? '<span class="current-badge">지금</span>' : ""}
        </span>
        <span class="meal-card__meta">${time} · ${price.toLocaleString("ko-KR")}원</span>
      </span>
      <span class="meal-card__chevron" aria-hidden="true"></span>
    </button>
    <div class="meal-card__body" id="body-${meal.id}">
      <div class="meal-card__body-inner">
        <div>${trayTemplate(meal)}</div>
        <div class="meal-card__details">
          <div class="meal-card__info"><span>${meal.date}</span>${calorie}</div>
          <h3 class="menu-heading">메뉴</h3>
          <ul class="menu-list">${menuItems}</ul>
        </div>
      </div>
    </div>
  </article>`;
};

const findNextMeals = (todayKey) => {
  const future = getCachedMeals()
    .filter((meal) => meal.date > todayKey && meal.published && meal.operating !== false)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!future.length) return [];
  const nextDate = future[0].date;
  return future.filter((meal) => meal.date === nextDate);
};

const bindCardToggles = () => {
  document.querySelectorAll(".meal-card__toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".meal-card");
      const nextOpen = !card.classList.contains("is-open");
      card.classList.toggle("is-open", nextOpen);
      button.setAttribute("aria-expanded", String(nextOpen));
      manualOpenState.set(card.dataset.mealId, nextOpen);
    });
  });
  document.querySelectorAll(".tray-slot img").forEach((image) => {
    image.addEventListener("error", () => {
      const fallback = image.dataset.fallbackSrc;
      if (fallback && image.src !== fallback) {
        image.src = fallback;
        return;
      }
      const slot = image.closest(".tray-slot");
      markFoodImageFailed(slot?.dataset.foodName);
      slot?.classList.remove("has-image");
      image.remove();
    });
  });
};

export const renderHomeMeals = async () => {
  const renderId = ++homeRenderId;
  const list = document.querySelector("#meal-list");
  const empty = document.querySelector("#meal-empty");
  const guidance = document.querySelector("#meal-guidance");
  const todayKey = formatDateKey(getSeoulDate());
  const nowMinutes = getSeoulMinutes();
  const todayMeals = getCachedMeals().filter((meal) => meal.date === todayKey && meal.published && meal.operating !== false);
  const todayState = getDefaultState(todayMeals, nowMinutes);

  let visibleMeals = todayMeals;
  let state = todayState;
  if (!todayMeals.length || (!todayState.current && nowMinutes >= minutesFromTime(appSettings.lunchEnd))) {
    visibleMeals = findNextMeals(todayKey);
    state = { current: null, open: new Set(visibleMeals[0] ? [visibleMeals[0].type] : []) };
    guidance.textContent = visibleMeals.length
      ? `${visibleMeals[0].date}의 다음 제공 식사를 보여드려요.`
      : "다음 식단 등록을 기다리고 있어요.";
  } else if (todayState.current === "breakfast") {
    guidance.textContent = "조식과 오늘의 중식을 함께 확인하세요.";
  } else if (todayState.current === "lunch") {
    guidance.textContent = "지금 이용할 수 있는 중식 메뉴예요.";
  } else {
    guidance.textContent = "오늘 첫 식사를 미리 확인하세요.";
  }

  await Promise.all([hydrateMealNutrition(visibleMeals), hydrateMealImages(visibleMeals)]);
  if (renderId !== homeRenderId) return;

  empty.hidden = visibleMeals.length > 0;
  list.hidden = visibleMeals.length === 0;
  list.innerHTML = visibleMeals.map((meal) => mealCardTemplate(meal, state)).join("");
  bindCardToggles();
};

export const scheduleMealRefresh = () => {
  window.setInterval(renderHomeMeals, 60_000);
  window.matchMedia("(min-width: 960px)").addEventListener("change", renderHomeMeals);
};
