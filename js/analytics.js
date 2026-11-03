export const GA_MEASUREMENT_ID = "G-DTRPCFHW7Q";

const routeTitles = {
  home: "오늘의 식단",
  weekly: "주간 식단",
  calendar: "월간 메뉴",
  search: "메뉴 검색",
  community: "공지·건의",
  mypage: "마이페이지",
  developer: "개발자 정보",
  terms: "이용약관",
  privacy: "개인정보처리방침",
};

let lastTrackedRoute = null;
let searchTimer = null;
let lastSearch = { term: "", time: 0 };

const send = (eventName, parameters = {}) => {
  if (window.location.hostname !== "babfullmania.vercel.app") return;
  if (typeof window.gtag !== "function") return;
  window.gtag("event", eventName, parameters);
};

const trackSearch = (term) => {
  const now = Date.now();
  if (lastSearch.term === term && now - lastSearch.time < 2000) return;
  lastSearch = { term, time: now };
  send("search", { search_term: term });
};

export const analyticsPagePath = (route) => `/${route === "home" ? "" : route}`;

export const trackPageView = (route) => {
  if (route === lastTrackedRoute) return;
  lastTrackedRoute = route;
  const pagePath = analyticsPagePath(route);
  send("page_view", {
    page_title: `${routeTitles[route] || "밥풀매니아"} | 밥풀매니아`,
    page_location: `${window.location.origin}${window.location.pathname}${window.location.search}#${route}`,
    page_path: pagePath,
  });
};

const dateControlEvent = (target) => {
  const controls = {
    "home-date-prev": ["home", "previous"],
    "home-date-next": ["home", "next"],
    "today-button": ["home", "today"],
    "week-prev": ["weekly", "previous"],
    "week-next": ["weekly", "next"],
    "week-today": ["weekly", "current"],
    "month-prev": ["calendar", "previous"],
    "month-next": ["calendar", "next"],
    "month-today": ["calendar", "current"],
  };
  const detail = controls[target.id];
  if (detail) send("change_menu_period", { menu_view: detail[0], direction: detail[1] });
};

export const initAnalytics = () => {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    dateControlEvent(target);

    if (target.matches(".meal-card__toggle")) {
      window.setTimeout(() => {
        if (target.getAttribute("aria-expanded") === "true") send("view_meal_details");
      }, 0);
    }
    if (target.matches("[data-search-suggestion]")) {
      send("select_search_suggestion", { search_term: target.dataset.searchSuggestion || "" });
    }
    if (target.id === "kakao-login") send("login_start", { method: "kakao" });
    if (target.matches("[data-kakao-share]")) send("share", { method: "KakaoTalk" });
  });

  document.querySelector("#menu-search-form")?.addEventListener("submit", () => {
    window.clearTimeout(searchTimer);
    const term = document.querySelector("#menu-search")?.value.trim();
    if (term) trackSearch(term);
  });

  document.querySelector("#menu-search")?.addEventListener("input", (event) => {
    window.clearTimeout(searchTimer);
    const term = event.target.value.trim();
    if (term.length < 2) return;
    searchTimer = window.setTimeout(() => trackSearch(term), 900);
  });
};
