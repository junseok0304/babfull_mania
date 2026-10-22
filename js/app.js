import { renderHomeMeals, scheduleMealRefresh } from "./meal-display.js?v=20261022-4";
import { initPublicViews } from "./public-views.js";
import { initializeData } from "./data-service.js";
import { renderMyPage } from "./mypage.js";

const validRoutes = new Set(["home", "weekly", "calendar", "search", "mypage"]);
const malformedOAuthPrefix = "#mypage#access_token=";

if (window.location.hash.startsWith(malformedOAuthPrefix)) {
  sessionStorage.setItem("babfull:post-auth-route", "mypage");
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${window.location.hash.replace("#mypage#", "#")}`,
  );
}

const formatToday = () => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());

const setRoute = (route) => {
  const safeRoute = validRoutes.has(route) ? route : "home";
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.view === safeRoute);
  });
  document.querySelectorAll("[data-route]").forEach((link) => {
    const active = link.dataset.route === safeRoute;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const mobileMenu = document.querySelector("#mobile-menu");
  mobileMenu.hidden = true;
  document.querySelector("#menu-button").setAttribute("aria-expanded", "false");
};

const routeFromHash = () => window.location.hash.replace("#", "") || "home";

document.querySelector("#today-label").textContent = `오늘은 ${formatToday()}`;
document.querySelector("#menu-button").addEventListener("click", () => {
  const menu = document.querySelector("#mobile-menu");
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  document.querySelector("#menu-button").setAttribute("aria-expanded", String(willOpen));
});
window.addEventListener("hashchange", () => setRoute(routeFromHash()));
setRoute(routeFromHash());
const loadStartedAt = Date.now();
const dataState = await initializeData();
const loadStatus = document.querySelector("#meal-load-status");
const previewNotice = document.querySelector("#preview-notice");
if (dataState.mode === "supabase") {
  loadStatus.hidden = true;
  previewNotice.hidden = true;
} else {
  const remainingDelay = Math.max(0, 2500 - (Date.now() - loadStartedAt));
  window.setTimeout(() => {
    loadStatus.hidden = true;
    previewNotice.hidden = false;
  }, remainingDelay);
}
renderHomeMeals();
scheduleMealRefresh();
initPublicViews();
const hasSession = await renderMyPage();
if (hasSession && sessionStorage.getItem("babfull:post-auth-route") === "mypage") {
  sessionStorage.removeItem("babfull:post-auth-route");
  window.history.replaceState(null, "", "#mypage");
  setRoute("mypage");
}
