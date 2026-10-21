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
  if (safe === "usages") renderUsages();
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

export const getAutomaticMealType = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const breakfastWindow = [7 * 60 + 30, 10 * 60];
  const lunchWindow = [11 * 60, 14 * 60 + 30];
  if (minutes >= breakfastWindow[0] && minutes <= breakfastWindow[1]) return "breakfast";
  if (minutes >= lunchWindow[0] && minutes <= lunchWindow[1]) return "lunch";
  return minutes < lunchWindow[0] ? "breakfast" : "lunch";
};

const processUsage = async (profile) => {
  const today = formatDateKey(getSeoulDate());
  if (adminMode === "demo") {
    const type = getAutomaticMealType();
    if (demoUsages.some((usage) => usage.userId === profile.id && usage.date === today && usage.type === type)) {
      throw new Error("이미 사용 처리된 식권입니다.");
    }
    const usage = { id: Date.now(), userId: profile.id, userName: profile.name, affiliation: profile.affiliation, date: today, type, status: "active", price: type === "breakfast" ? 1000 : 5300 };
    demoUsages.unshift(usage);
    return usage;
  }
  const { data, error } = await client.rpc("process_scanned_meal_usage", { target_qr_token: profile.qr_token });
  if (error) throw new Error(error.message || "식권을 처리하지 못했습니다.");
  return Array.isArray(data) ? data[0] : data;
};

const renderScannedProfile = (profile, usage) => {
  const target = document.querySelector("#scan-result");
  target.innerHTML = `<div class="scanned-profile"><div class="scanned-profile__avatar">${escapeHtml(profile.name?.[0] || "밥")}</div><div><strong>${escapeHtml(profile.name || "이름 미등록")}</strong><span>${escapeHtml(profile.affiliation || "소속 미등록")}</span></div></div>
    <div class="usage-auto-result">
      <span>${escapeHtml(usage.meal_date || usage.date)} · 자동 선택 · 제공시간 ±30분</span>
      <strong>${mealLabel(usage.meal_type || usage.type)} · ${Number(usage.price).toLocaleString("ko-KR")}원</strong>
      <p class="scan-message">${adminMode === "demo" ? "시연 이용 기록을 저장했습니다." : "이용 기록을 저장했습니다."}</p>
      <a href="#usages">날짜나 식사가 다른가요? 이용 내역에서 수정 →</a>
    </div>`;
};

const handleDecodedToken = async (token) => {
  const target = document.querySelector("#scan-result");
  target.innerHTML = '<div class="scan-empty"><span>사용자를 확인하고 있어요.</span></div>';
  try {
    const profile = await findProfileByToken(token.trim());
    target.innerHTML = '<div class="scan-empty"><span>이용 기록을 저장하고 있어요.</span></div>';
    const usage = await processUsage(profile);
    renderScannedProfile(profile, usage);
    renderStats();
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

const normalizeUsage = (record) => ({
  id: record.id,
  userId: record.user_id,
  userName: record.profiles?.name || record.userName || "이름 미등록",
  affiliation: record.profiles?.affiliation || record.affiliation || "소속 미등록",
  date: record.meal_date || record.date,
  type: record.meal_type || record.type,
  price: Number(record.price),
  status: record.status || "active",
  note: record.correction_note || "",
});

const updateUsage = async (usageId, date, type, status, note) => {
  if (adminMode === "demo") {
    const usage = demoUsages.find((item) => String(item.id) === String(usageId));
    if (!usage) throw new Error("이용 기록을 찾을 수 없습니다.");
    const conflict = status === "active" && demoUsages.some((item) => item !== usage && item.userId === usage.userId && item.date === date && item.type === type && item.status === "active");
    if (conflict) throw new Error("같은 날짜·식사 이용 기록이 이미 있습니다.");
    Object.assign(usage, { date, type, status, note, price: type === "breakfast" ? 1000 : 5300 });
    return;
  }
  const { error } = await client.rpc("admin_update_meal_usage", {
    target_usage_id: Number(usageId), target_meal_date: date, target_meal_type: type, target_status: status, note: note || null,
  });
  if (error) throw new Error(error.message || "이용 기록을 수정하지 못했습니다.");
};

const renderUsages = async () => {
  const target = document.querySelector("#usage-admin-list");
  if (!target) return;
  target.innerHTML = '<p class="usage-admin-loading">이용 내역을 불러오고 있어요.</p>';
  let records = demoUsages.map(normalizeUsage);
  if (adminMode === "supabase") {
    const { data, error } = await client.from("meal_usages")
      .select("id, user_id, meal_date, meal_type, price, status, correction_note, created_at, profiles!meal_usages_user_id_fkey(name, affiliation)")
      .order("created_at", { ascending: false }).limit(100);
    if (error) {
      target.innerHTML = `<p class="usage-admin-loading is-error">${escapeHtml(error.message)}</p>`;
      return;
    }
    records = (data ?? []).map(normalizeUsage);
  }
  if (!records.length) {
    target.innerHTML = '<div class="scan-empty"><span>아직 이용 기록이 없습니다.</span><p>QR을 인식하면 바로 이곳에 표시됩니다.</p></div>';
    return;
  }
  target.innerHTML = records.map((usage) => `<form class="usage-admin-item" data-usage-id="${usage.id}">
    <div class="usage-admin-person"><strong>${escapeHtml(usage.userName)}</strong><span>${escapeHtml(usage.affiliation)} · ${escapeHtml(usage.date)}</span></div>
    <label><span class="sr-only">이용 날짜</span><input name="meal_date" type="date" value="${escapeHtml(usage.date)}" required /></label>
    <fieldset class="usage-segmented"><legend class="sr-only">식사 구분</legend><label><input type="radio" name="meal_type" value="breakfast"${usage.type === "breakfast" ? " checked" : ""} /><span>조식</span></label><label><input type="radio" name="meal_type" value="lunch"${usage.type === "lunch" ? " checked" : ""} /><span>중식</span></label></fieldset>
    <fieldset class="usage-segmented usage-segmented--status"><legend class="sr-only">처리 상태</legend><label><input type="radio" name="status" value="active"${usage.status === "active" ? " checked" : ""} /><span>정상</span></label><label><input type="radio" name="status" value="cancelled"${usage.status === "cancelled" ? " checked" : ""} /><span>취소</span></label></fieldset>
    <label><span class="sr-only">정정 사유</span><input name="note" value="${escapeHtml(usage.note)}" placeholder="정정 사유" /></label>
    <button class="secondary-button" type="submit">저장</button>
    <p class="usage-admin-message" role="status"></p>
  </form>`).join("");

  target.querySelectorAll(".usage-admin-item").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector(".usage-admin-message");
    const button = form.querySelector("button");
    const data = new FormData(form);
    button.disabled = true;
    message.textContent = "저장 중…";
    try {
      await updateUsage(form.dataset.usageId, data.get("meal_date"), data.get("meal_type"), data.get("status"), data.get("note"));
      message.textContent = "수정됨";
      renderStats();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("is-error");
    } finally {
      button.disabled = false;
    }
  }));
};

document.querySelector("#usage-refresh").addEventListener("click", renderUsages);

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
