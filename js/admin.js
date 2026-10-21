import { formatDateKey, getSeoulDate, sampleMeals } from "./sample-data.js";
import { getSupabaseClient } from "./supabase-client.js";

const titles = { dashboard: "대시보드", meals: "식단 관리", scanner: "QR 스캐너", users: "사용자 관리", usages: "이용 내역" };
let adminMode = "demo";
let meals = [...sampleMeals];
let client = null;
let qrScanner = null;
const demoUsages = [];
const demoQrToken = "00000000-0000-4000-8000-000000000001";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const route = (nextRoute) => {
  const safe = titles[nextRoute] ? nextRoute : "dashboard";
  if (safe !== "scanner" && qrScanner?.isScanning) stopScanner();
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
  const todayUsages = demoUsages.filter((usage) => usage.date === today);
  const todayAmount = todayUsages.reduce((sum, usage) => sum + usage.price, 0);
  document.querySelector("#admin-stats").innerHTML = [
    ["오늘 등록 식단", `${todayMeals.length}건`],
    ["공개 중인 식단", `${published}건`],
    ["오늘 식권 이용", `${todayUsages.length}건`],
    ["오늘 이용 금액", `${todayAmount.toLocaleString("ko-KR")}원`],
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

const loadScannerLibrary = () => new Promise((resolve, reject) => {
  if (window.Html5Qrcode) return resolve(window.Html5Qrcode);
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
  script.onload = () => resolve(window.Html5Qrcode);
  script.onerror = () => reject(new Error("QR 스캐너 라이브러리를 불러오지 못했습니다."));
  document.head.append(script);
});

const stopScanner = async () => {
  if (qrScanner?.isScanning) await qrScanner.stop();
  qrScanner = null;
  document.querySelector("#scanner-start").disabled = false;
  document.querySelector("#scanner-stop").disabled = true;
};

const findProfileByToken = async (token) => {
  if (adminMode === "demo") {
    if (token !== demoQrToken) throw new Error("시연용 사용자를 찾을 수 없습니다.");
    return { id: "demo-user", name: "밥풀 학생", affiliation: "IT융합자율학부", qr_token: demoQrToken, is_active: true };
  }
  const { data, error } = await client.from("profiles").select("id, name, affiliation, qr_token, is_active").eq("qr_token", token).eq("is_active", true).single();
  if (error || !data) throw new Error("유효한 사용자를 찾을 수 없습니다.");
  return data;
};

const processUsage = async (profile, type) => {
  const today = formatDateKey(getSeoulDate());
  if (adminMode === "demo") {
    if (demoUsages.some((usage) => usage.userId === profile.id && usage.date === today && usage.type === type)) {
      throw new Error("이미 사용 처리된 식권입니다.");
    }
    demoUsages.push({ userId: profile.id, date: today, type, price: type === "breakfast" ? 1000 : 5300 });
    return;
  }
  const { error } = await client.rpc("process_meal_usage", { target_qr_token: profile.qr_token, target_meal_type: type, target_meal_date: today });
  if (error) throw new Error(error.message || "식권을 처리하지 못했습니다.");
};

const renderScannedProfile = (profile) => {
  const target = document.querySelector("#scan-result");
  target.innerHTML = `<div class="scanned-profile"><div class="scanned-profile__avatar">${escapeHtml(profile.name?.[0] || "밥")}</div><div><strong>${escapeHtml(profile.name || "이름 미등록")}</strong><span>${escapeHtml(profile.affiliation || "소속 미등록")}</span></div></div>
    <form class="usage-confirm-form" id="usage-confirm-form">
      <label>식사 구분<select name="meal_type"><option value="breakfast">조식</option><option value="lunch">중식</option></select></label>
      <div class="confirm-price"><span>처리 금액</span><strong id="confirm-price">1,000원</strong></div>
      <button class="primary-button" type="submit">식권 사용 처리</button>
      <p class="scan-message" id="scan-message">사용자와 식사 구분을 확인한 뒤 처리해 주세요.</p>
    </form>`;
  const form = document.querySelector("#usage-confirm-form");
  const select = form.elements.meal_type;
  select.addEventListener("change", () => {
    document.querySelector("#confirm-price").textContent = select.value === "breakfast" ? "1,000원" : "5,300원";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const message = document.querySelector("#scan-message");
    button.disabled = true;
    message.classList.remove("is-error");
    message.textContent = "처리 중…";
    try {
      await processUsage(profile, select.value);
      message.textContent = adminMode === "demo" ? "시연 식권을 사용 처리했습니다." : "식권을 사용 처리했습니다.";
      renderStats();
    } catch (error) {
      message.classList.add("is-error");
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
};

const handleDecodedToken = async (token) => {
  const target = document.querySelector("#scan-result");
  target.innerHTML = '<div class="scan-empty"><span>사용자를 확인하고 있어요.</span></div>';
  try {
    const profile = await findProfileByToken(token.trim());
    renderScannedProfile(profile);
  } catch (error) {
    target.innerHTML = `<div class="scan-empty"><span>조회 실패</span><p>${escapeHtml(error.message)}</p></div>`;
  }
};

document.querySelector("#scanner-start").addEventListener("click", async () => {
  const start = document.querySelector("#scanner-start");
  const stop = document.querySelector("#scanner-stop");
  start.disabled = true;
  try {
    const Html5Qrcode = await loadScannerLibrary();
    document.querySelector("#qr-reader").innerHTML = "";
    qrScanner = new Html5Qrcode("qr-reader");
    await qrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 230, height: 230 } }, async (text) => {
      await stopScanner();
      await handleDecodedToken(text);
    }, () => {});
    stop.disabled = false;
  } catch (error) {
    start.disabled = false;
    document.querySelector("#qr-reader").innerHTML = `<div class="scanner-placeholder"><span>!</span><p>${escapeHtml(error.message || "카메라를 시작하지 못했습니다.")}</p></div>`;
  }
});

document.querySelector("#scanner-stop").addEventListener("click", stopScanner);
document.querySelector("#manual-token-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await handleDecodedToken(new FormData(event.currentTarget).get("qr_token"));
});

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
