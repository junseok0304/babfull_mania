import { formatDateKey, getSeoulDate, sampleMeals } from "./sample-data.js";
import { getSupabaseClient } from "./supabase-client.js";

const titles = { dashboard: "대시보드", meals: "식단 관리", scanner: "QR 스캐너", users: "사용자 관리", usages: "이용 내역" };
let adminMode = "demo";
let meals = [...sampleMeals];
let client = null;

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const route = (nextRoute) => {
  const safe = titles[nextRoute] ? nextRoute : "dashboard";
  document.querySelectorAll("[data-admin-view]").forEach((view) => view.classList.toggle("is-active", view.dataset.adminView === safe));
  document.querySelectorAll("[data-admin-route]").forEach((link) => link.classList.toggle("is-active", link.dataset.adminRoute === safe));
  document.querySelector("#admin-page-title").textContent = titles[safe];
  document.querySelector(".admin-sidebar").classList.remove("is-open");
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", "false");
};

const mealLabel = (type) => type === "breakfast" ? "조식" : "중식";

const renderStats = () => {
  const today = formatDateKey(getSeoulDate());
  const todayMeals = meals.filter((meal) => meal.date === today);
  const published = meals.filter((meal) => meal.published).length;
  document.querySelector("#admin-stats").innerHTML = [
    ["오늘 등록 식단", `${todayMeals.length}건`],
    ["공개 중인 식단", `${published}건`],
    ["오늘 식권 이용", "0건"],
    ["오늘 이용 금액", "0원"],
  ].map(([label, value]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
};

const sortedMeals = () => [...meals].sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));

const renderMeals = () => {
  const recent = sortedMeals().slice(0, 6);
  document.querySelector("#dashboard-meals").innerHTML = recent.map((meal) => `<tr><td>${meal.date}</td><td>${mealLabel(meal.type)}</td><td>${meal.items.slice(0, 3).map(escapeHtml).join(" · ")}</td><td>${meal.published ? "공개" : "비공개"}</td></tr>`).join("");
  document.querySelector("#meal-admin-list").innerHTML = sortedMeals().slice(0, 14).map((meal) => `<article class="meal-admin-item">
    <div class="meal-admin-item__top"><strong>${meal.date} · ${mealLabel(meal.type)}</strong><span>${meal.published ? "공개" : "비공개"}</span></div>
    <p>${meal.items.map(escapeHtml).join(" · ")}</p>
  </article>`).join("");
};

const mapDatabaseMeal = (record) => ({
  id: record.id,
  date: record.meal_date,
  type: record.meal_type,
  published: record.is_published,
  items: [...(record.meal_items ?? [])].sort((a, b) => a.display_order - b.display_order).map((item) => item.original_menu_text),
});

const initializeAdmin = async () => {
  client = await getSupabaseClient();
  const notice = document.querySelector("#admin-notice");
  if (!client) {
    document.querySelector("#admin-mode").textContent = "시연 모드";
    notice.hidden = false;
    notice.textContent = "Supabase 미연결 상태입니다. 아래 등록은 현재 화면의 시연 데이터에만 반영되며 실제 저장되지 않습니다.";
    return;
  }

  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user?.id;
  const { data: profile } = userId
    ? await client.from("profiles").select("role, is_active").eq("id", userId).single()
    : { data: null };
  if (!profile || profile.role !== "admin" || !profile.is_active) {
    document.querySelector("#admin-mode").textContent = "권한 없음";
    notice.hidden = false;
    notice.textContent = "활성 관리자 계정으로 로그인해야 실제 관리자 기능을 사용할 수 있습니다.";
    document.querySelector("#meal-form").querySelector("button[type=submit]").disabled = true;
    return;
  }

  const { data, error } = await client.from("meals").select("id, meal_date, meal_type, is_published, meal_items(display_order, original_menu_text)").order("meal_date", { ascending: false }).limit(80);
  if (!error) meals = (data ?? []).map(mapDatabaseMeal);
  adminMode = "supabase";
  document.querySelector("#admin-mode").textContent = "관리자 연결됨";
};

const saveMeal = async (payload) => {
  if (adminMode === "demo") {
    const id = `${payload.mealDate}-${payload.mealType}`;
    meals = meals.filter((meal) => meal.id !== id && !(meal.date === payload.mealDate && meal.type === payload.mealType));
    meals.push({ id, date: payload.mealDate, type: payload.mealType, items: payload.menuItems, published: payload.isPublished });
    return;
  }
  const { error } = await client.rpc("admin_upsert_meal", {
    target_date: payload.mealDate,
    target_type: payload.mealType,
    menu_names: payload.menuItems,
    operating: payload.isOperating,
    published: payload.isPublished,
    note: payload.adminNote || null,
  });
  if (error) throw error;
  const { data } = await client.from("meals").select("id, meal_date, meal_type, is_published, meal_items(display_order, original_menu_text)").order("meal_date", { ascending: false }).limit(80);
  meals = (data ?? []).map(mapDatabaseMeal);
};

document.querySelector("#admin-menu-button").addEventListener("click", () => {
  const sidebar = document.querySelector(".admin-sidebar");
  const open = !sidebar.classList.contains("is-open");
  sidebar.classList.toggle("is-open", open);
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", String(open));
});

window.addEventListener("hashchange", () => route(location.hash.slice(1)));
document.querySelector("#meal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = document.querySelector("#meal-form-message");
  const data = new FormData(form);
  const menuItems = String(data.get("menu_items")).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!menuItems.length) return;
  button.disabled = true;
  message.textContent = "저장 중…";
  try {
    await saveMeal({
      mealDate: data.get("meal_date"), mealType: data.get("meal_type"), menuItems,
      adminNote: data.get("admin_note"), isOperating: data.get("is_operating") === "on", isPublished: data.get("is_published") === "on",
    });
    message.textContent = adminMode === "demo" ? "시연 목록에 반영했습니다. 실제 DB에는 저장되지 않았습니다." : "식단을 저장했습니다.";
    form.elements.menu_items.value = "";
    form.elements.admin_note.value = "";
    renderStats();
    renderMeals();
  } catch (error) {
    message.textContent = error.message || "식단을 저장하지 못했습니다.";
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#meal-form").elements.meal_date.value = formatDateKey(getSeoulDate());
await initializeAdmin();
route(location.hash.slice(1));
renderStats();
renderMeals();
