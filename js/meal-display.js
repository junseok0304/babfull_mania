import { appSettings, formatDateKey, getSeoulDate } from "./sample-data.js";
import { getCachedMeals } from "./data-service.js";
import { getMealNutrition, hydrateMealNutrition } from "./nutrition-service.js";
import { getFoodImage, hydrateMealImages, markFoodImageFailed } from "./food-image-service.js";

const labels = { breakfast: "조식", lunch: "중식" };
const icons = { breakfast: "☀️", lunch: "🍚" };
const manualOpenState = new Map();
let homeRenderId = 0;
let homeWeekdayIndex = null;
let homeNavigationBound = false;

const addDays = (date, amount) => {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
};

const getMonday = (date) => addDays(date, -((date.getDay() + 6) % 7));

const getCurrentWeekdayIndex = (date) => Math.min((date.getDay() + 6) % 7, 4);

const getSelectedWeekdayIndex = (today) => homeWeekdayIndex ?? getCurrentWeekdayIndex(today);

const formatHomeDate = (date) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
}).format(date);

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

  if (remaining.length <= 6) {
    const wideSlots = ["side-1", "side-2", "side-3", "side-4"];
    const narrowCount = Math.max(0, remaining.length - wideSlots.length);
    const narrowItems = [...remaining]
      .sort((a, b) => [...a.name].length - [...b.name].length)
      .slice(0, narrowCount);
    const wideItems = remaining.filter((item) => !narrowItems.includes(item));
    wideItems.forEach((item, index) => result.push({ name: item.name, slot: wideSlots[index] }));
    const narrowSlots = narrowCount === 1 ? ["side-5"] : ["small", "side-5"];
    narrowItems.forEach((item, index) => result.push({ name: item.name, slot: narrowSlots[index] }));
    return result;
  }

  const slots = ["side-1-top", "side-1-bottom", "side-2-top", "side-2-bottom", "side-3", "side-4", "small", "side-5"];
  remaining.slice(0, slots.length).forEach((item, index) => result.push({ name: item.name, slot: slots[index] }));
  return result;
};

export const resolveHomeAvailability = (dateMeals, selectedDate) => {
  const visibleMeals = dateMeals.filter((meal) => meal.operating !== false && meal.items.length > 0);
  const closedNotes = [...new Set(dateMeals
    .filter((meal) => meal.operating === false)
    .map((meal) => meal.note)
    .filter(Boolean))];
  const isClosed = !visibleMeals.length && (closedNotes.length > 0 || [0, 6].includes(selectedDate.getDay()));
  return {
    visibleMeals,
    closedNotes,
    state: visibleMeals.length ? "available" : isClosed ? "closed" : "empty",
  };
};

export const resolveTrayPresentation = (displayMode, trayImage) => {
  if (displayMode !== "ai") return "menu-images";
  return trayImage?.imageUrl ? "generated" : "menu-text";
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export const formatTrayLabel = (value) => escapeHtml(value)
  .replaceAll("&amp;", "&amp;<wbr>")
  .replaceAll("/", "/<wbr>");

const cropStyle = (image) => {
  const zoom = Number(image.cropZoom) || 1.08;
  const focalX = Number(image.focalX ?? 50);
  const focalY = Number(image.focalY ?? 50);
  const maxShift = zoom > 1 ? ((zoom - 1) * 50) / zoom : 0;
  const shiftX = ((50 - focalX) / 100) * maxShift;
  const shiftY = ((50 - focalY) / 100) * maxShift;
  return `--food-zoom:${zoom};--food-shift-x:${shiftX}%;--food-shift-y:${shiftY}%`;
};

const trayTemplate = (meal, { textOnly = false } = {}) => {
  const slots = arrangeTray(meal.items)
    .map(({ name, slot }) => {
      const image = textOnly ? null : getFoodImage(name);
      const sourceUrl = image?.documentUrl || image?.imageUrl || image?.fallbackUrl;
      const imageElement = image ? `<img src="${escapeHtml(image.imageUrl || image.fallbackUrl)}"
        data-fallback-src="${escapeHtml(image.fallbackUrl || "")}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
        style="${cropStyle(image)}" />` : "";
      const imageMarkup = imageElement && sourceUrl
        ? `<a class="tray-slot__source" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(name)} 사진 원본 출처 열기" title="사진 원본 출처 보기">${imageElement}</a>`
        : imageElement;
      return `<div class="tray-slot tray-slot--${slot}${image ? " has-image" : ""}" data-food-name="${escapeHtml(name)}">
        ${imageMarkup}<span>${formatTrayLabel(name)}</span>
      </div>`;
    })
    .join("");
  return `<div class="meal-tray${textOnly ? " meal-tray--text-only" : ""}" aria-label="${labels[meal.type]} 메뉴 참고 식판">${slots}</div>
    <p class="tray-caption">메뉴별 음식 사진은 실제 제공 모습과 다를 수 있어요.</p>`;
};

const generatedTrayTemplate = (meal) => {
  const imageUrl = meal.trayImage?.imageUrl;
  if (!imageUrl) return trayTemplate(meal, { textOnly: true });
  const alt = meal.trayImage.altText || `${meal.date} ${labels[meal.type]} 완성 식판 이미지`;
  return `<figure class="generated-tray">
    <a href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(alt)} 원본 보기">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />
    </a>
    <figcaption>메뉴를 바탕으로 미리 제작한 식판 이미지예요. 실제 제공 모습과 다를 수 있어요.</figcaption>
  </figure>`;
};

const mealDateLabel = (dateKey) => {
  const [, month, day] = String(dateKey).split("-").map(Number);
  return `${month}월 ${day}일`;
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
  const trayPresentation = resolveTrayPresentation(appSettings.trayDisplayMode, meal.trayImage);
  const trayContent = trayPresentation === "generated"
    ? generatedTrayTemplate(meal)
    : trayTemplate(meal, { textOnly: trayPresentation === "menu-text" });

  return `<article class="meal-card meal-card--${meal.type}${isOpen ? " is-open" : ""}${isCurrent ? " is-current" : ""}" data-meal-id="${meal.id}">
    <button class="meal-card__toggle" type="button" aria-expanded="${isOpen}" aria-controls="body-${meal.id}">
      <span class="meal-card__icon" aria-hidden="true">${icons[meal.type]}</span>
      <span class="meal-card__heading">
        <span class="meal-card__title-row">
          <strong class="meal-card__title">${labels[meal.type]} 식단 <span>(${mealDateLabel(meal.date)})</span></strong>
          ${calorie}
        </span>
        <span class="meal-card__meta">제공시간 ${time.replace("–", " ~ ")} <b>가격 ${price.toLocaleString("ko-KR")}원</b></span>
      </span>
      <span class="meal-card__chevron" aria-hidden="true"></span>
    </button>
    <div class="meal-card__body" id="body-${meal.id}">
      <div class="meal-card__body-inner">
        <div>${trayContent}</div>
        <div class="meal-card__details">
          <h3 class="menu-heading">메뉴</h3>
          <ul class="menu-list">${menuItems}</ul>
        </div>
      </div>
    </div>
  </article>`;
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
  const today = getSeoulDate();
  const selectedWeekdayIndex = getSelectedWeekdayIndex(today);
  const selectedDate = addDays(getMonday(today), selectedWeekdayIndex);
  const selectedDateKey = formatDateKey(selectedDate);
  const isToday = selectedDateKey === formatDateKey(today);
  const nowMinutes = getSeoulMinutes();
  const dateMeals = getCachedMeals().filter((meal) => meal.date === selectedDateKey && meal.published);
  const availability = resolveHomeAvailability(dateMeals, selectedDate);
  const { visibleMeals, closedNotes } = availability;
  const state = isToday
    ? getDefaultState(visibleMeals, nowMinutes)
    : { current: null, open: new Set(visibleMeals.map((meal) => meal.type)) };
  const isClosed = availability.state === "closed";

  document.querySelector("#home-selected-date").textContent = formatHomeDate(selectedDate);
  document.querySelector("#home-date-offset").textContent = isToday ? "오늘" : `${["월", "화", "수", "목", "금"][selectedWeekdayIndex]}요일`;
  document.querySelector("#home-date-prev").disabled = selectedWeekdayIndex === 0;
  document.querySelector("#home-date-next").disabled = selectedWeekdayIndex === 4;
  document.querySelector("#today-button").textContent = [0, 6].includes(today.getDay()) ? "이번 주" : "오늘";

  if (isClosed) {
    guidance.textContent = "휴무일입니다.";
  } else if (!visibleMeals.length) {
    guidance.textContent = "선택한 날짜에는 식사가 제공되지 않습니다.";
  } else if (!isToday) {
    guidance.textContent = `${formatHomeDate(selectedDate)} 식단입니다.`;
  } else if (state.current === "breakfast") {
    guidance.textContent = "조식과 오늘의 중식을 함께 확인하세요.";
  } else if (state.current === "lunch") {
    guidance.textContent = "지금 이용할 수 있는 중식 메뉴예요.";
  } else {
    guidance.textContent = "오늘 제공되는 식단입니다.";
  }

  await Promise.all([hydrateMealNutrition(visibleMeals), hydrateMealImages(visibleMeals)]);
  if (renderId !== homeRenderId) return;

  empty.hidden = visibleMeals.length > 0;
  list.hidden = visibleMeals.length === 0;
  empty.classList.toggle("is-closed", isClosed);
  document.querySelector("#meal-empty-title").textContent = isClosed ? "휴무일" : "식사 미제공";
  document.querySelector("#meal-empty-description").textContent = isClosed
    ? (closedNotes.join(" · ") || "식당을 운영하지 않는 날입니다.")
    : "선택한 날짜에 등록된 식단이 없습니다.";
  list.innerHTML = visibleMeals.map((meal) => mealCardTemplate(meal, state)).join("");
  bindCardToggles();
};

export const scheduleMealRefresh = () => {
  window.setInterval(renderHomeMeals, 60_000);
  window.matchMedia("(min-width: 960px)").addEventListener("change", renderHomeMeals);
  if (!homeNavigationBound) {
    homeNavigationBound = true;
    const moveDate = (amount) => {
      const today = getSeoulDate();
      homeWeekdayIndex = Math.max(0, Math.min(4, getSelectedWeekdayIndex(today) + amount));
      manualOpenState.clear();
      renderHomeMeals();
    };
    document.querySelector("#home-date-prev").addEventListener("click", () => moveDate(-1));
    document.querySelector("#home-date-next").addEventListener("click", () => moveDate(1));
    document.querySelector("#today-button").addEventListener("click", () => {
      homeWeekdayIndex = null;
      manualOpenState.clear();
      renderHomeMeals();
    });
  }
};
