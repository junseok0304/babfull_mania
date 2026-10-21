import { renderHomeMeals, scheduleMealRefresh } from "./meal-display.js";
import { initPublicViews } from "./public-views.js";

const validRoutes = new Set(["home", "weekly", "calendar", "search", "mypage"]);

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
renderHomeMeals();
scheduleMealRefresh();
initPublicViews();
