import { formatDateKey, getSeoulDate, sampleMeals } from "./sample-data.js";
import { getSupabaseClient } from "./supabase-client.js";
import { buildDashboardSummary, defaultOperationalSettings, getAutomaticMealType, getManualMealState, isDuplicateMealUsageError, normalizeKakaoShareStats, shouldShowClosureReason } from "./admin-utils.js?v=20261104-1";
import { initAdminCommunity } from "./admin-community.js?v=20261115-2";

/**
 * 관리자 콘솔의 화면 전환과 운영 작업을 연결하는 진입 모듈입니다.
 * 계산·검증처럼 DOM과 무관한 규칙은 admin-utils.js에 두고, 이 파일은
 * Supabase 조회, 폼 이벤트, QR 스캐너와 화면 렌더링을 조정합니다.
 */

// 현재 관리 화면에서 공유하는 세션·운영 상태입니다. 데모 모드에서는 원격 DB를 변경하지 않습니다.
const titles = { dashboard: "대시보드", meals: "식단 관리", notices: "공지사항 관리", suggestions: "건의사항 관리", scanner: "QR 스캐너", users: "사용자 관리", usages: "이용 내역", settings: "운영 설정" };
let adminMode = "demo";
let meals = [...sampleMeals];
let client = null;
let qrScanner = null;
let currentUserId = null;
let operationalSettings = { ...defaultOperationalSettings };
let scannerAudioContext = null;
let scanBusy = false;
let scannerTestMode = false;
let foodImageCandidates = [];
let foodImageMenuNames = [];
let allFoodImageMenuNames = [];
let savedFoodImageNames = new Set();
let savedFoodImages = [];
let foodImageListMode = "pending";
let foodImageMenuIndex = 0;
let foodImageWorkspaceData = null;
let foodImageEditTarget = null;
let foodImageBrowsingStarted = false;
let mealListPage = 1;
const mealListPageSize = 5;
const foodImageSearchPages = new Map();
const demoUsages = [];
const demoQrToken = "00000000-0000-4000-8000-000000000001";
let dashboardStats = buildDashboardSummary();
let dashboardKakaoShares = [];
let dashboardSuggestions = [];
let todayScannerUsers = 0;
let todayScannerRevenue = 0;
const scannerRecentEntries = [];
const scannerRecentPageSize = 5;
let scannerRecentPage = 1;
let scannerPrivacyEnabled = true;
let scannerPrivacyStrength = 1.2;
let scannerNotices = [];

// 사용자 입력이나 DB 문자열을 innerHTML에 넣기 전에 이 함수를 거쳐 XSS를 방지합니다.
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

// 브라우저 기본 select 팝업 대신 관리자 UI와 같은 색상·간격의 목록을 사용합니다.
const closeAdminPopovers = (exception = null) => {
  document.querySelectorAll(".admin-select.is-open, .admin-date-picker.is-open").forEach((control) => {
    if (control !== exception) {
      control.classList.remove("is-open");
      control.querySelector('[aria-expanded="true"]')?.setAttribute("aria-expanded", "false");
    }
  });
};

const enhanceAdminSelect = (select) => {
  if (select.dataset.adminEnhanced === "true") return;
  select.dataset.adminEnhanced = "true";
  const control = document.createElement("div");
  control.className = "admin-select";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "admin-select__button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.className = "admin-select__list";
  list.setAttribute("role", "listbox");
  select.before(control);
  control.append(select, button, list);

  const render = () => {
    const options = [...select.options];
    const selected = options.find((option) => option.selected) || options[0];
    button.innerHTML = `<span>${escapeHtml(selected?.textContent || "선택")}</span><i aria-hidden="true"></i>`;
    button.disabled = select.disabled;
    list.innerHTML = options.map((option) => `<button type="button" role="option" data-value="${escapeHtml(option.value)}" aria-selected="${option.selected}">${escapeHtml(option.textContent)}</button>`).join("");
  };
  render();

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    render();
    const opening = !control.classList.contains("is-open");
    closeAdminPopovers(opening ? control : null);
    control.classList.toggle("is-open", opening);
    button.setAttribute("aria-expanded", String(opening));
  });
  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-value]");
    if (!option) return;
    select.value = option.dataset.value;
    render();
    control.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  new MutationObserver(render).observe(select, { attributes: true, childList: true, subtree: true });
};

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthKey = (date) => dateKey(date).slice(0, 7);
const enhanceUsageDatePicker = () => {
  const form = document.querySelector("#usage-filter-form");
  const input = form?.elements.date;
  const monthInput = form?.elements.month;
  if (!input || !monthInput || input.dataset.adminEnhanced === "true") return;
  input.dataset.adminEnhanced = "true";
  const picker = document.createElement("div");
  picker.className = "admin-date-picker";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "admin-date-picker__button";
  button.setAttribute("aria-haspopup", "dialog");
  const calendar = document.createElement("div");
  calendar.className = "admin-date-picker__calendar";
  calendar.setAttribute("role", "dialog");
  calendar.setAttribute("aria-label", "이용 기간 선택");
  input.before(picker);
  picker.append(input, monthInput, button, calendar);
  let visibleMonth = getSeoulDate();
  const selectedMode = () => form.elements.period_mode.value;

  const updateButton = () => {
    const isMonth = selectedMode() === "month";
    const value = isMonth ? monthInput.value : input.value;
    const label = value
      ? (isMonth ? `${value.slice(0, 4)}년 ${Number(value.slice(5, 7))}월` : new Intl.DateTimeFormat("ko-KR", { dateStyle: "long" }).format(new Date(`${value}T12:00:00`)))
      : (isMonth ? "조회할 월을 선택하세요" : "조회할 날짜를 선택하세요");
    button.innerHTML = `<span>${escapeHtml(label)}</span><b aria-hidden="true">▣</b>`;
  };
  const renderCalendar = () => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const modeTabs = `<div class="admin-calendar__modes"><button type="button" data-calendar-mode="day" class="${selectedMode() === "day" ? "is-active" : ""}">일별 조회</button><button type="button" data-calendar-mode="month" class="${selectedMode() === "month" ? "is-active" : ""}">월별 조회</button></div>`;
    if (selectedMode() === "month") {
      calendar.innerHTML = `${modeTabs}<div class="admin-calendar__header"><button type="button" data-calendar-move="-1" aria-label="이전 연도">‹</button><strong>${year}년</strong><button type="button" data-calendar-move="1" aria-label="다음 연도">›</button></div><div class="admin-calendar__months">${Array.from({ length: 12 }, (_, index) => {
        const key = `${year}-${String(index + 1).padStart(2, "0")}`;
        return `<button type="button" data-calendar-month="${key}" class="${key === monthInput.value ? "is-selected " : ""}${key === monthKey(getSeoulDate()) ? "is-today" : ""}">${index + 1}월</button>`;
      }).join("")}</div><div class="admin-calendar__footer"><button type="button" data-calendar-clear>선택 해제</button><button type="button" data-calendar-today>이번 달</button></div>`;
      return;
    }
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const days = Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
    calendar.innerHTML = `${modeTabs}<div class="admin-calendar__header"><button type="button" data-calendar-move="-1" aria-label="이전 달">‹</button><strong>${year}년 ${month + 1}월</strong><button type="button" data-calendar-move="1" aria-label="다음 달">›</button></div><div class="admin-calendar__weekdays">${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}</div><div class="admin-calendar__days">${days.map((day) => {
      const key = dateKey(day);
      return `<button type="button" data-calendar-date="${key}" class="${day.getMonth() !== month ? "is-outside " : ""}${key === input.value ? "is-selected " : ""}${key === dateKey(getSeoulDate()) ? "is-today" : ""}">${day.getDate()}</button>`;
    }).join("")}</div><div class="admin-calendar__footer"><button type="button" data-calendar-clear>선택 해제</button><button type="button" data-calendar-today>오늘</button></div>`;
  };
  updateButton();
  input._refreshAdminDate = updateButton;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const value = selectedMode() === "month" ? monthInput.value : input.value;
    if (value) visibleMonth = new Date(`${value}${value.length === 7 ? "-01" : ""}T12:00:00`);
    renderCalendar();
    const opening = !picker.classList.contains("is-open");
    closeAdminPopovers(opening ? picker : null);
    picker.classList.toggle("is-open", opening);
  });
  calendar.addEventListener("click", (event) => {
    event.stopPropagation();
    const mode = event.target.closest("[data-calendar-mode]");
    if (mode) {
      form.elements.period_mode.value = mode.dataset.calendarMode;
      updateButton();
      renderCalendar();
      return;
    }
    const move = event.target.closest("[data-calendar-move]");
    if (move) {
      const amount = Number(move.dataset.calendarMove) * (selectedMode() === "month" ? 12 : 1);
      visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + amount, 1);
      renderCalendar();
      return;
    }
    if (event.target.closest("[data-calendar-today]")) {
      if (selectedMode() === "month") monthInput.value = monthKey(getSeoulDate());
      else input.value = dateKey(getSeoulDate());
    } else if (event.target.closest("[data-calendar-clear]")) {
      if (selectedMode() === "month") monthInput.value = "";
      else input.value = "";
    }
    else {
      const month = event.target.closest("[data-calendar-month]");
      const day = event.target.closest("[data-calendar-date]");
      if (month) monthInput.value = month.dataset.calendarMonth;
      else if (day) input.value = day.dataset.calendarDate;
      else return;
    }
    updateButton();
    picker.classList.remove("is-open");
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // 날짜를 고르는 즉시 필터 폼을 제출해 별도의 '날짜 조회' 클릭을 줄입니다.
    input.form?.requestSubmit();
  });
  form.querySelectorAll('input[name="period_mode"]').forEach((radio) => radio.addEventListener("change", () => {
    updateButton();
    if (picker.classList.contains("is-open")) renderCalendar();
  }));
};

document.addEventListener("click", () => closeAdminPopovers());
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAdminPopovers(); });

const route = (nextRoute) => {
  // 기존 #community 링크는 분리된 공지사항 관리 화면으로 안전하게 연결합니다.
  const candidate = nextRoute === "community" ? "notices" : nextRoute;
  const safe = titles[candidate] ? candidate : "dashboard";
  document.body.classList.toggle("is-scanner-mode", safe === "scanner");
  if (safe !== "scanner" && qrScanner?.isScanning) stopScanner();
  document.querySelectorAll("[data-admin-view]").forEach((view) => view.classList.toggle("is-active", view.dataset.adminView === safe));
  document.querySelectorAll("[data-admin-route]").forEach((link) => link.classList.toggle("is-active", link.dataset.adminRoute === safe));
  document.querySelector("#admin-page-title").textContent = titles[safe];
  document.querySelector(".admin-sidebar").classList.remove("is-open");
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", "false");
  if (safe === "usages") renderUsages();
  if (safe === "users") renderUsers();
  if (safe === "settings") renderSettings();
};

const mealLabel = (type) => type === "breakfast" ? "조식" : "중식";

// ── 대시보드·식단·대표 이미지 관리 ──────────────────────────────────────
const updateFoodImageMenuNavigator = () => {
  const count = foodImageMenuNames.length;
  foodImageMenuIndex = count ? (foodImageMenuIndex + count) % count : 0;
  const foodName = foodImageMenuNames[foodImageMenuIndex] || "";
  document.querySelector("#food-image-menu").value = foodName;
  document.querySelector("#food-image-menu-name").textContent = foodName || "등록된 메뉴가 없습니다.";
  document.querySelector("#food-image-progress").textContent = count ? `메뉴 ${foodImageMenuIndex + 1} / ${count}` : "메뉴 0 / 0";
  document.querySelector("#food-image-prev").disabled = count < 2;
  document.querySelector("#food-image-next").disabled = count < 2;
};

const refreshFoodImageMenuList = (preferredName = "") => {
  const previousName = preferredName || document.querySelector("#food-image-menu")?.value || "";
  foodImageMenuNames = allFoodImageMenuNames.filter((name) => (
    foodImageListMode === "saved" ? savedFoodImageNames.has(name) : !savedFoodImageNames.has(name)
  ));
  const preferredIndex = foodImageMenuNames.indexOf(previousName);
  foodImageMenuIndex = preferredIndex >= 0 ? preferredIndex : Math.min(foodImageMenuIndex, Math.max(0, foodImageMenuNames.length - 1));
  document.querySelector("#food-image-pending-count").textContent = allFoodImageMenuNames.filter((name) => !savedFoodImageNames.has(name)).length;
  document.querySelector("#food-image-saved-count").textContent = allFoodImageMenuNames.filter((name) => savedFoodImageNames.has(name)).length;
  document.querySelectorAll("[data-food-image-list]").forEach((button) => button.classList.toggle("is-active", button.dataset.foodImageList === foodImageListMode));
  const isSavedList = foodImageListMode === "saved";
  document.querySelector("#food-image-search-form").hidden = isSavedList;
  document.querySelector("#food-image-workspace").hidden = isSavedList;
  document.querySelector("#saved-food-image-grid").hidden = !isSavedList;
  updateFoodImageMenuNavigator();
};

const renderSavedFoodImageGrid = () => {
  const target = document.querySelector("#saved-food-image-grid");
  if (!savedFoodImages.length) {
    target.innerHTML = '<div class="food-image-empty"><strong>아직 확정 저장한 사진이 없습니다.</strong><span>미설정 메뉴에서 대표 사진을 저장하면 이곳에 모입니다.</span></div>';
    return;
  }
  target.innerHTML = savedFoodImages
    .filter((image) => allFoodImageMenuNames.includes(image.foodName))
    .sort((a, b) => a.foodName.localeCompare(b.foodName, "ko"))
    .map((image) => `<article class="saved-food-image-card">
      <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(image.foodName)} 확정 대표 사진" loading="lazy" referrerpolicy="no-referrer" />
      <div><strong>${escapeHtml(image.foodName)}</strong><span>${escapeHtml(image.sourceName || "대표 사진")}</span></div>
      <button class="secondary-button" type="button" data-unselect-food-image="${image.id}">저장 해제 후 다시 검수</button>
    </article>`).join("");
};

const renderStats = () => {
  document.querySelector("#admin-stats").innerHTML = [
    ["전체 등록 회원", `${dashboardStats.totalMembers.toLocaleString("ko-KR")}명`],
    ["오늘 이용", `${dashboardStats.todayUsageCount.toLocaleString("ko-KR")}건`],
    ["이번 달 누적 사용", `${dashboardStats.monthUsageCount.toLocaleString("ko-KR")}건`],
    ["이번 달 이용 매출", `${dashboardStats.monthRevenue.toLocaleString("ko-KR")}원`],
  ].map(([label, value]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join("");

  document.querySelector("#dashboard-meal-ratio").innerHTML = `<div class="ratio-summary"><strong>조식 ${dashboardStats.breakfastPercent}%</strong><strong>중식 ${dashboardStats.lunchPercent}%</strong></div><div class="ratio-bar" aria-label="조식 ${dashboardStats.breakfastCount}건, 중식 ${dashboardStats.lunchCount}건"><span style="width:${dashboardStats.breakfastPercent}%"></span></div><p>조식 ${dashboardStats.breakfastCount.toLocaleString("ko-KR")}건 · 중식 ${dashboardStats.lunchCount.toLocaleString("ko-KR")}건</p>`;
  const target = document.querySelector("#dashboard-affiliations");
  const max = Math.max(1, ...dashboardStats.affiliations.map((item) => item.count));
  target.innerHTML = dashboardStats.affiliations.length ? dashboardStats.affiliations.map((item) => `<div class="affiliation-stat"><div><span>${escapeHtml(item.affiliation)}</span><strong>${item.count.toLocaleString("ko-KR")}명</strong></div><div><span style="width:${Math.round((item.count / max) * 100)}%"></span></div></div>`).join("") : '<p class="dashboard-empty">이번 달 이용 기록이 없습니다.</p>';

  const shareTarget = document.querySelector("#dashboard-kakao-shares");
  const shareTotal = dashboardKakaoShares.reduce((sum, item) => sum + item.count, 0);
  shareTarget.innerHTML = dashboardKakaoShares.length
    ? `<p class="dashboard-share-total">전체 <strong>${shareTotal.toLocaleString("ko-KR")}회</strong></p><div class="dashboard-share-list">${dashboardKakaoShares.map((item) => {
      const lastShared = item.lastSharedAt
        ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.lastSharedAt))
        : "기록 없음";
      return `<div class="dashboard-share-row"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.affiliation)} · 최근 ${escapeHtml(lastShared)}</span></div><b>${item.count.toLocaleString("ko-KR")}회</b></div>`;
    }).join("")}</div>`
    : '<p class="dashboard-empty">이번 달 카카오 공유창 실행 기록이 없습니다.</p>';

  const suggestionTarget = document.querySelector("#dashboard-suggestions");
  suggestionTarget.innerHTML = dashboardSuggestions.length ? dashboardSuggestions.slice(0, 5).map((item) => `<a href="#suggestions" data-admin-route="suggestions" class="dashboard-suggestion-row">
    <div><span>${item.isPrivate ? "운영진 전용" : "공개 건의"}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.authorName)}</small></div>
    <time>${escapeHtml(new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" }).format(new Date(item.createdAt)))}</time>
  </a>`).join("") : '<p class="dashboard-empty">최근 접수된 건의사항이 없습니다.</p>';
};

const loadDashboardStats = async () => {
  if (adminMode !== "supabase") {
    const today = formatDateKey(getSeoulDate());
    const active = demoUsages.filter((usage) => usage.status === "active");
    dashboardStats = buildDashboardSummary({ today_usage_count: active.filter((usage) => usage.date === today).length, month_usage_count: active.length, month_revenue: active.reduce((sum, usage) => sum + usage.price, 0), breakfast_count: active.filter((usage) => usage.type === "breakfast").length, lunch_count: active.filter((usage) => usage.type === "lunch").length });
    const todayUsages = active.filter((usage) => usage.date === today);
    todayScannerUsers = new Set(todayUsages.map((usage) => usage.userId)).size;
    todayScannerRevenue = todayUsages.reduce((sum, usage) => sum + Number(usage.price || 0), 0);
    dashboardKakaoShares = [];
    return;
  }
  const month = `${formatDateKey(getSeoulDate()).slice(0, 7)}-01`;
  const today = formatDateKey(getSeoulDate());
  const [usageResult, shareResult, todayResult] = await Promise.all([
    client.rpc("admin_dashboard_stats", { target_month: month }),
    client.rpc("admin_kakao_share_stats", { target_month: month }),
    client.from("meal_usages").select("user_id, price").eq("meal_date", today).eq("status", "active"),
  ]);
  if (usageResult.error) throw usageResult.error;
  if (shareResult.error) throw shareResult.error;
  if (todayResult.error) throw todayResult.error;
  dashboardStats = buildDashboardSummary(usageResult.data);
  dashboardKakaoShares = normalizeKakaoShareStats(shareResult.data);
  todayScannerUsers = new Set((todayResult.data || []).map((usage) => usage.user_id)).size;
  todayScannerRevenue = (todayResult.data || []).reduce((sum, usage) => sum + Number(usage.price || 0), 0);
};

const refreshDashboard = async () => {
  try { await loadDashboardStats(); } catch (error) { console.error("대시보드 통계 조회 실패", error); }
  renderStats();
  const scannerToday = document.querySelector("#scan-terminal-today");
  const scannerRevenue = document.querySelector("#scan-today-revenue");
  if (scannerToday) scannerToday.textContent = todayScannerUsers.toLocaleString("ko-KR");
  if (scannerRevenue) scannerRevenue.textContent = `${todayScannerRevenue.toLocaleString("ko-KR")}원`;
};

const syncFoodImageManagerVisibility = () => {
  const manager = document.querySelector("#food-image-manager");
  // 운영 화면은 AI 식판 이미지만 사용하므로 메뉴별 외부 사진 관리 도구는 노출하지 않습니다.
  if (manager) manager.hidden = true;
};

const sortedMeals = () => [...meals].sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));

const adminMealStatus = (meal) => {
  if (meal.operating === false) {
    const isUnavailable = /미제공|메뉴가 없습니다/u.test(meal.note || "");
    return isUnavailable ? { label: "미제공", kind: "empty" } : { label: "휴무", kind: "closed" };
  }
  if (!meal.items.length) return { label: "미제공", kind: "empty" };
  return { label: meal.published ? "공개" : "비공개", kind: meal.published ? "published" : "hidden" };
};

const renderTrayImageManager = () => {
  const select = document.querySelector("#tray-image-meal");
  const preview = document.querySelector("#tray-image-preview");
  if (!select || !preview) return;
  const selectedId = select.value;
  const available = sortedMeals().filter((meal) => meal.published && meal.items.length);
  select.innerHTML = available.map((meal) => `<option value="${escapeHtml(meal.id)}"${String(meal.id) === selectedId ? " selected" : ""}>${escapeHtml(meal.date)} · ${mealLabel(meal.type)}${meal.trayImage ? " · 이미지 등록됨" : ""}</option>`).join("");
  if (!select.value && available[0]) select.value = String(available[0].id);
  const meal = available.find((item) => String(item.id) === select.value);
  if (meal?.trayImage?.imageUrl) {
    preview.classList.add("has-image");
    preview.innerHTML = `<img src="${escapeHtml(meal.trayImage.imageUrl)}" alt="${escapeHtml(meal.trayImage.altText || `${meal.date} ${mealLabel(meal.type)} 완성 식판`)}" /><span>현재 저장된 고정 식판 이미지</span>`;
  } else {
    preview.classList.remove("has-image");
    preview.innerHTML = "<span>이미지를 선택하면 미리보기가 표시됩니다.</span>";
  }
};

const renderMealList = () => {
  const allMeals = sortedMeals();
  const totalPages = Math.max(1, Math.ceil(allMeals.length / mealListPageSize));
  mealListPage = Math.min(Math.max(1, mealListPage), totalPages);
  const pageStart = (mealListPage - 1) * mealListPageSize;
  const pageMeals = allMeals.slice(pageStart, pageStart + mealListPageSize);
  document.querySelector("#meal-admin-list").innerHTML = pageMeals.length ? pageMeals.map((meal) => {
    const status = adminMealStatus(meal);
    const description = meal.items.length
      ? meal.items.map(escapeHtml).join(" · ")
      : escapeHtml(meal.note || (meal.operating === false ? "식당을 운영하지 않는 날입니다." : "등록된 메뉴가 없습니다."));
    return `<article class="meal-admin-item">
      <div class="meal-admin-item__top"><strong>${meal.date} · ${mealLabel(meal.type)}</strong><span class="meal-admin-status meal-admin-status--${status.kind}">${status.label}</span></div>
      <p>${description}</p>
    </article>`;
  }).join("") : '<div class="meal-admin-empty">등록된 식단이 없습니다.</div>';

  const pagination = document.querySelector("#meal-pagination");
  pagination.innerHTML = `<button type="button" data-meal-page="${mealListPage - 1}" aria-label="이전 페이지"${mealListPage === 1 ? " disabled" : ""}>‹</button>
    <span><strong>${mealListPage}</strong> / ${totalPages} 페이지 · 전체 ${allMeals.length}건</span>
    <button type="button" data-meal-page="${mealListPage + 1}" aria-label="다음 페이지"${mealListPage === totalPages ? " disabled" : ""}>›</button>`;
  pagination.querySelectorAll("[data-meal-page]").forEach((button) => button.addEventListener("click", () => {
    mealListPage = Number(button.dataset.mealPage);
    renderMealList();
  }));
};

const renderMeals = () => {
  const recent = sortedMeals().slice(0, 6);
  document.querySelector("#dashboard-meals").innerHTML = recent.map((meal) => `<tr><td>${meal.date}</td><td>${mealLabel(meal.type)}</td><td>${meal.items.slice(0, 3).map(escapeHtml).join(" · ")}</td><td>${meal.published ? "공개" : "비공개"}</td></tr>`).join("");
  renderMealList();
  const selectedMenu = document.querySelector("#food-image-menu").value;
  const menuNames = [...new Set(sortedMeals().flatMap((meal) => meal.items))]
    .filter((name) => name && !/운영시간|메뉴가 없습니다|휴무/u.test(name))
    .sort((a, b) => a.localeCompare(b, "ko"));
  allFoodImageMenuNames = menuNames;
  refreshFoodImageMenuList(selectedMenu);
  renderTrayImageManager();
};

const getPreviewCrop = (image) => {
  const zoom = Number(image.cropZoom) || 1.08;
  const focalX = Number(image.focalX ?? 50);
  const focalY = Number(image.focalY ?? 50);
  const maxShift = zoom > 1 ? ((zoom - 1) * 50) / zoom : 0;
  return {
    zoom,
    shiftX: ((50 - focalX) / 100) * maxShift,
    shiftY: ((50 - focalY) / 100) * maxShift,
  };
};

const imageMarkup = (image, className = "") => {
  const crop = getPreviewCrop(image);
  return `<img class="${className}" src="${escapeHtml(image.imageUrl || image.fallbackUrl)}"
    data-fallback-src="${escapeHtml(image.fallbackUrl || "")}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
    style="--preview-zoom:${crop.zoom};--preview-shift-x:${crop.shiftX}%;--preview-shift-y:${crop.shiftY}%" />`;
};

const bindManagedImageFallbacks = () => {
  document.querySelectorAll("#food-image-workspace img").forEach((image) => {
    image.addEventListener("error", () => {
      const fallback = image.dataset.fallbackSrc;
      if (fallback && image.src !== fallback) image.src = fallback;
      else {
        image.closest("figure, .food-image-candidate")?.classList.add("is-broken");
        image.remove();
      }
    });
  });
};

const renderFoodImageWorkspace = (data) => {
  foodImageWorkspaceData = data;
  foodImageCandidates = data.candidates ?? [];
  if (!foodImageEditTarget || foodImageEditTarget.foodId !== data.food.id) {
    foodImageEditTarget = data.current ? { ...data.current, foodId: data.food.id } : null;
  }
  const editor = foodImageEditTarget
    ? `<div class="food-image-editor">
        <div class="food-image-editor__preview">${imageMarkup(foodImageEditTarget)}</div>
        <div class="food-image-editor__controls">
          <label><span>확대 <output id="food-image-zoom-value">${Number(foodImageEditTarget.cropZoom || 1.08).toFixed(2)}배</output></span><input data-crop-control="cropZoom" type="range" min="1" max="2.5" step="0.05" value="${Number(foodImageEditTarget.cropZoom) || 1.08}" /></label>
          <label><span>가로 확대 중심 <output id="food-image-x-value">${Number(foodImageEditTarget.focalX ?? 50)}%</output></span><input data-crop-control="focalX" type="range" min="-50" max="150" step="1" value="${Number(foodImageEditTarget.focalX ?? 50)}" /></label>
          <label><span>세로 확대 중심 <output id="food-image-y-value">${Number(foodImageEditTarget.focalY ?? 50)}%</output></span><input data-crop-control="focalY" type="range" min="-50" max="150" step="1" value="${Number(foodImageEditTarget.focalY ?? 50)}" /></label>
          <button class="primary-button" type="button" data-save-food-image>이 사진과 구도 저장</button>
        </div>
      </div>`
    : '<div class="food-image-current is-empty"><strong>후보 사진을 선택하면 큰 화면에서 구도를 편집할 수 있습니다.</strong></div>';
  const candidates = foodImageCandidates.length
    ? `<div class="food-image-candidates">${foodImageCandidates.map((candidate, index) => `<article class="food-image-candidate">
        <div class="food-image-candidate__preview">${imageMarkup(candidate)}</div>
        <div class="food-image-candidate__meta"><span><b>${escapeHtml(candidate.provider || "Kakao")}</b>${escapeHtml(candidate.sourceName || "이미지 검색")}</span><small>${candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : "크기 정보 없음"}</small></div>
        <button class="secondary-button" type="button" data-image-candidate="${index}">선택하고 구도 편집</button>
      </article>`).join("")}</div>`
    : '<div class="food-image-empty"><strong>다른 사진 후보를 찾지 못했습니다.</strong><span>잠시 후 다시 검색해주세요.</span></div>';
  const providerNote = data.providers?.google
    ? "이미지 후보 출처: Kakao 이미지 검색 · Google 이미지 검색"
    : "이미지 후보 출처: Kakao 이미지 검색";
  document.querySelector("#food-image-workspace").innerHTML = `<div class="food-image-current-panel"><h3>${escapeHtml(data.food.name)} 구도 편집</h3>${editor}</div><div class="food-image-results"><div class="food-image-results__heading"><h3>대체 사진 후보</h3><span>${escapeHtml(providerNote)}</span></div>${candidates}</div>`;
  bindManagedImageFallbacks();
};

const getFunctionErrorMessage = async (error, data, fallbackMessage) => {
  if (data?.error) return data.error;
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const payload = await response.clone().json();
      if (payload?.error) return payload.error;
    } catch {
      // JSON 응답이 아니면 아래의 일반 메시지를 사용한다.
    }
  }
  if (error?.message === "Edge Function returned a non-2xx status code") return fallbackMessage;
  return error?.message || fallbackMessage;
};

const firstRelated = (value) => Array.isArray(value) ? value[0] : value;

const loadFoodImageCandidates = async (foodName, searchPage = 1) => {
  if (adminMode !== "supabase") throw new Error("운영 데이터 연결 후 사용할 수 있습니다.");
  const { data, error } = await client.functions.invoke("manage-food-image", {
    body: { action: "candidates", foodName, searchPage },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error, data, "사진 후보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요."));
  foodImageSearchPages.set(foodName, Number(data.searchPage) || searchPage);
  renderFoodImageWorkspace(data);
  document.querySelector("#food-image-search-form button[type=submit]").textContent = "다른 사진 다시 불러오기";
};

const mapDatabaseMeal = (record) => ({
  id: record.id,
  date: record.meal_date,
  type: record.meal_type,
  published: record.is_published,
  operating: record.is_operating,
  note: record.admin_note,
  trayImage: firstRelated(record.meal_tray_images) ? {
    id: firstRelated(record.meal_tray_images).id,
    storagePath: firstRelated(record.meal_tray_images).storage_path,
    imageUrl: firstRelated(record.meal_tray_images).image_url,
    altText: firstRelated(record.meal_tray_images).alt_text,
  } : null,
  items: [...(record.meal_items ?? [])].sort((a, b) => a.display_order - b.display_order).map((item) => item.original_menu_text),
});

const loadDatabaseMeals = async () => {
  const { data, error } = await client.from("meals")
    .select("id, meal_date, meal_type, is_published, is_operating, admin_note, meal_tray_images(id, storage_path, image_url, alt_text), meal_items(display_order, original_menu_text)")
    .order("meal_date", { ascending: false });
  if (error) throw error;
  meals = (data ?? []).map(mapDatabaseMeal);
};

const loadSavedFoodImageNames = async () => {
  if (!client) return;
  const { data, error } = await client.from("food_images")
    .select("id, storage_path, source_url, source_name, reviewed_by, foods(original_name)")
    .ilike("license_note", "%admin-selected%")
    .not("reviewed_by", "is", null);
  if (error) throw error;
  savedFoodImages = (data ?? []).map((row) => ({
    id: row.id,
    foodName: row.foods?.original_name,
    imageUrl: row.source_url || row.storage_path,
    sourceName: row.source_name,
  })).filter((image) => image.foodName && image.imageUrl);
  savedFoodImageNames = new Set(savedFoodImages.map((image) => image.foodName));
};

const loadOperationalSettings = async () => {
  if (!client) return;
  const [{ data: hours }, { data: prices }] = await Promise.all([
    client.from("app_settings").select("setting_value").eq("setting_key", "meal_hours").single(),
    client.from("app_settings").select("setting_value").eq("setting_key", "meal_prices").single(),
  ]);
  const value = hours?.setting_value ?? {};
  const priceValue = prices?.setting_value ?? {};
  operationalSettings = {
    breakfastStart: value.breakfast_start || defaultOperationalSettings.breakfastStart,
    breakfastEnd: value.breakfast_end || defaultOperationalSettings.breakfastEnd,
    lunchStart: value.lunch_start || defaultOperationalSettings.lunchStart,
    lunchEnd: value.lunch_end || defaultOperationalSettings.lunchEnd,
    scanBufferMinutes: Number(value.scan_buffer_minutes ?? defaultOperationalSettings.scanBufferMinutes),
    breakfastPrice: Number(priceValue.breakfast ?? defaultOperationalSettings.breakfastPrice),
    lunchPrice: Number(priceValue.lunch ?? defaultOperationalSettings.lunchPrice),
    trayDisplayMode: "ai",
  };
};

const rejectAdminAccess = () => {
  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    window.location.replace("/api/admin-denied");
    return;
  }
  document.title = "400 · 관리자 접근 거부";
  document.body.innerHTML = '<main class="admin-error"><span>400</span><h1>잘못된 요청입니다</h1><p>활성 관리자 계정으로 로그인해야 접근할 수 있습니다.</p><a href="../index.html#home">사용자 화면으로 돌아가기</a></main>';
};

const renderImportStatus = async () => {
  const target = document.querySelector("#menu-import-status");
  const button = document.querySelector("#menu-sync");
  if (adminMode !== "supabase") {
    button.disabled = true;
    target.innerHTML = "<p><strong>운영 데이터 연결 후 사용할 수 있습니다.</strong></p><p>원본 식단 응답으로 수집 형식을 검증했습니다.</p>";
    return;
  }
  const { data, error } = await client.from("meal_import_logs").select("status, started_at, completed_at, inserted_count, updated_count, error_message")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  target.classList.toggle("is-error", Boolean(error || data?.status === "failed"));
  if (error) {
    target.innerHTML = `<p>수집 로그를 불러오지 못했습니다: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data) {
    target.innerHTML = '<p><strong>아직 수집 기록이 없습니다.</strong></p><p>지금 가져오기를 누르면 이번 주 조식·중식을 저장합니다.</p>';
    return;
  }
  const statusLabel = data.status === "success" ? "성공" : data.status === "running" ? "진행 중" : "실패";
  const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(data.completed_at || data.started_at));
  target.innerHTML = `<p><strong>최근 수집 ${statusLabel}</strong>${data.error_message ? ` · ${escapeHtml(data.error_message)}` : ""}</p><div class="import-status__meta"><span>${escapeHtml(time)}</span><span>신규 ${data.inserted_count}건</span><span>변경 ${data.updated_count}건</span></div>`;
};

const initializeAdmin = async () => {
  const isLocalDemo = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get("demo") === "1";
  if (isLocalDemo) return true;
  client = await getSupabaseClient();
  const notice = document.querySelector("#admin-notice");
  if (!client) {
    notice.hidden = false;
    notice.textContent = "운영 데이터를 불러오지 못했습니다. 아래 등록은 현재 화면의 시연 데이터에만 반영되며 실제 저장되지 않습니다.";
    return true;
  }

  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user?.id;
  const { data: profile } = userId
    ? await client.from("profiles").select("role, is_active").eq("id", userId).single()
    : { data: null };
  if (!profile || profile.role !== "admin" || !profile.is_active) {
    rejectAdminAccess();
    return false;
  }

  currentUserId = userId;
  await loadOperationalSettings();
  await loadDatabaseMeals();
  await loadSavedFoodImageNames();
  adminMode = "supabase";
  syncFoodImageManagerVisibility();
  return true;
};

// ── QR 스캐너와 식권 이용 처리 ──────────────────────────────────────────
// 스캔 성공 직후 scanBusy를 유지해 동일 QR이 연속 프레임에서 중복 처리되는 것을 막습니다.
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
  document.body.classList.remove("scanner-is-active");
  document.querySelector("#scanner-start").disabled = false;
  document.querySelector("#scanner-stop").disabled = true;
};

const prepareScannerAudio = async () => {
  scannerAudioContext ??= new (window.AudioContext || window.webkitAudioContext)();
  if (scannerAudioContext.state === "suspended") await scannerAudioContext.resume();
};

const playSuccessChime = () => {
  if (!scannerAudioContext) return;
  const now = scannerAudioContext.currentTime;
  [659.25, 783.99, 1046.5].forEach((frequency, index) => {
    const oscillator = scannerAudioContext.createOscillator();
    const gain = scannerAudioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.0001, now + index * 0.11);
    gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.11 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.11 + 0.24);
    oscillator.connect(gain).connect(scannerAudioContext.destination);
    oscillator.start(now + index * 0.11);
    oscillator.stop(now + index * 0.11 + 0.26);
  });
};

// 중복 사용은 성공음과 혼동되지 않도록 낮아지는 두 음으로 즉시 알립니다.
const playDuplicateChime = () => {
  if (!scannerAudioContext) return;
  const now = scannerAudioContext.currentTime;
  [440, 293.66].forEach((frequency, index) => {
    const oscillator = scannerAudioContext.createOscillator();
    const gain = scannerAudioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "triangle";
    gain.gain.setValueAtTime(0.0001, now + index * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.28);
    oscillator.connect(gain).connect(scannerAudioContext.destination);
    oscillator.start(now + index * 0.18);
    oscillator.stop(now + index * 0.18 + 0.3);
  });
};

const playScannerFailureChime = () => {
  // 장시간 운영 중 브라우저가 오디오를 일시 중지했어도 스캔 시작 때 허용된
  // AudioContext를 다시 깨운 뒤 성공음과 다른 하강 경고음을 재생합니다.
  prepareScannerAudio().then(playDuplicateChime).catch(() => {});
};

const renderScannerStatus = (message, isError = false) => {
  document.querySelector("#scan-result").innerHTML = `<div class="scan-kiosk-status${isError ? " is-error" : ""}"><span class="scan-kiosk-status__dot"></span><strong>${escapeHtml(message)}</strong></div>`;
};

// 키오스크를 보는 사용자가 인증 시각을 바로 확인할 수 있도록 서울 시각을 분 단위로 표시합니다.
const updateScannerClock = () => {
  const target = document.querySelector("#scanner-clock");
  if (!target) return;
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  target.dateTime = now.toISOString();
  target.innerHTML = `<span class="scanner-clock__date">${parts.month}/${parts.day}</span><span class="scanner-clock__time"><span>${parts.hour}</span><span class="scanner-clock__separator" aria-hidden="true">:</span><span>${parts.minute}</span></span>`;
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

const setScanDefaults = () => {
  const date = formatDateKey(getSeoulDate());
  const type = getAutomaticMealType(new Date(), operationalSettings);
  document.querySelector("#scan-meal-date").value = date;
  const input = document.querySelector(`input[name="scan_meal_type"][value="${type}"]`);
  if (input) input.checked = true;
  document.querySelector("#scan-auto-hint").textContent = `${date} · ${mealLabel(type)}으로 자동 선택했습니다. 인식 전에 변경할 수 있습니다.`;
  document.querySelector("#scan-breakfast-label").textContent = `조식 · ${operationalSettings.breakfastPrice.toLocaleString("ko-KR")}원`;
  document.querySelector("#scan-lunch-label").textContent = `중식 · ${operationalSettings.lunchPrice.toLocaleString("ko-KR")}원`;
  syncScannerMetrics();
  renderScannerMeal();
};

const getSelectedScannerPrice = () => (
  document.querySelector('input[name="scan_meal_type"]:checked')?.value === "breakfast"
    ? operationalSettings.breakfastPrice
    : operationalSettings.lunchPrice
);

const syncScannerMetrics = () => {
  const price = document.querySelector("#scan-terminal-price");
  const today = document.querySelector("#scan-terminal-today");
  const revenue = document.querySelector("#scan-today-revenue");
  const type = document.querySelector('input[name="scan_meal_type"]:checked')?.value || "lunch";
  if (price) price.textContent = `${getSelectedScannerPrice().toLocaleString("ko-KR")}원 (${mealLabel(type)})`;
  if (today) today.textContent = todayScannerUsers.toLocaleString("ko-KR");
  if (revenue) revenue.textContent = `${todayScannerRevenue.toLocaleString("ko-KR")}원`;
  const date = document.querySelector("#scan-meal-date")?.value;
  const selectedPrice = getSelectedScannerPrice();
  const timeRange = type === "breakfast"
    ? `${operationalSettings.breakfastStart}–${operationalSettings.breakfastEnd}`
    : `${operationalSettings.lunchStart}–${operationalSettings.lunchEnd}`;
  const weekday = date
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(new Date(`${date}T12:00:00+09:00`))
    : "";
  document.querySelector("#scanner-standard-date").textContent = date ? `${date} (${weekday})` : "-";
  document.querySelector("#scanner-standard-meal").textContent = `${mealLabel(type)} · ${selectedPrice.toLocaleString("ko-KR")}원`;
  document.querySelector("#scanner-standard-time").textContent = timeRange;
};

// 선택한 이용 날짜·식사 구분의 식단을 스캐너 화면에 함께 표시합니다.
// 이미지가 아직 생성되지 않은 식단은 메뉴명을 식판 칸에 배치해 빈 화면을 방지합니다.
const renderScannerMeal = () => {
  const target = document.querySelector("#scanner-today-meal");
  const title = document.querySelector("#scanner-meal-title");
  const kicker = document.querySelector("#scanner-meal-kicker");
  if (!target || !title || !kicker) return;
  const date = document.querySelector("#scan-meal-date")?.value || formatDateKey(getSeoulDate());
  const type = document.querySelector('input[name="scan_meal_type"]:checked')?.value || "lunch";
  const meal = meals.find((item) => item.date === date && item.type === type);
  const isToday = date === formatDateKey(getSeoulDate());
  kicker.textContent = isToday ? "오늘 식단" : "선택한 날짜의 식단";
  title.textContent = `${date} · ${mealLabel(type)}`;
  if (!meal?.items?.length) {
    const selectedDate = new Date(`${date}T12:00:00`);
    const isWeekend = selectedDate.getDay() === 0 || selectedDate.getDay() === 6;
    const emptyTitle = isToday && isWeekend ? "오늘은 운영 식단이 없어요" : "등록된 식단이 없어요";
    const emptyDescription = isToday && isWeekend
      ? "주말에는 정기 식단을 운영하지 않습니다. 다음 운영일 식단은 사용자 화면에서 확인할 수 있어요."
      : "운영 상세에서 날짜나 식사 구분을 확인해 주세요.";
    target.innerHTML = `<div class="scanner-meal-empty"><strong>${emptyTitle}</strong><p>${emptyDescription}</p></div>`;
    return;
  }
  const menuList = `<ul>${meal.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const fallbackMarkup = () => {
    const slots = meal.items.slice(0, 6).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
    return `<figure class="scanner-meal-fallback" aria-label="식판 이미지 미제공, 메뉴명으로 표시">${slots}</figure><p class="scanner-meal-fallback-note">식판 이미지 준비 중</p>${menuList}`;
  };
  if (meal.trayImage?.imageUrl) {
    const imageCaption = `오늘의 ${mealLabel(type)}`;
    target.innerHTML = `<figure class="scanner-meal-image"><img src="${escapeHtml(meal.trayImage.imageUrl)}" alt="${escapeHtml(meal.trayImage.altText || `${date} ${mealLabel(type)} 식판`)}" /><figcaption>${imageCaption}</figcaption></figure>${menuList}`;
    target.querySelector("img").addEventListener("error", () => { target.innerHTML = fallbackMarkup(); }, { once: true });
    return;
  }
  target.innerHTML = fallbackMarkup();
};

const renderScannerReady = () => {
  const terminal = document.querySelector("#scan-terminal");
  terminal.dataset.state = "ready";
  document.querySelector("#scan-terminal-state").textContent = "대기 중";
  document.querySelector("#scan-terminal-title").innerHTML = "정기권 QR을<br />스캔해 주세요";
  document.querySelector("#scan-terminal-description").textContent = "인증되면 이용 정보가 여기에 표시돼요";
  document.querySelector("#scan-terminal-user").textContent = "-";
  document.querySelector("#scan-terminal-monthly").textContent = "-";
  document.querySelector("#scan-terminal-total").textContent = "-";
  const notice = document.querySelector("#scan-terminal-notice");
  notice.hidden = true;
  notice.textContent = "";
  syncScannerMetrics();
};

const renderScannerRecentEntries = () => {
  const target = document.querySelector("#scanner-recent-list");
  const count = document.querySelector("#scanner-recent-count");
  const pagination = document.querySelector("#scanner-recent-pagination");
  if (!target) return;
  const pageCount = Math.max(1, Math.ceil(scannerRecentEntries.length / scannerRecentPageSize));
  scannerRecentPage = Math.min(Math.max(scannerRecentPage, 1), pageCount);
  const pageEntries = scannerRecentEntries.slice((scannerRecentPage - 1) * scannerRecentPageSize, scannerRecentPage * scannerRecentPageSize);
  if (count) count.textContent = `${scannerRecentEntries.length}건`;
  target.innerHTML = pageEntries.length
    ? pageEntries.map((entry) => `<div class="scanner-recent-item is-${entry.status}"><span>${escapeHtml(entry.time)}</span><strong>${escapeHtml(entry.name)}</strong><b>${escapeHtml(entry.label)}</b><em>${escapeHtml(entry.detail)}</em></div>`).join("")
    : "<p>아직 인증 내역이 없어요</p>";
  if (pagination) pagination.innerHTML = scannerRecentEntries.length > scannerRecentPageSize ? `
    <button type="button" data-scanner-recent-page="${scannerRecentPage - 1}"${scannerRecentPage === 1 ? " disabled" : ""}>이전</button>
    <span>${scannerRecentPage} / ${pageCount}</span>
    <button type="button" data-scanner-recent-page="${scannerRecentPage + 1}"${scannerRecentPage === pageCount ? " disabled" : ""}>다음</button>` : "";
};

const addScannerRecentEntry = ({ status, name, label, detail }) => {
  scannerRecentEntries.unshift({
    status,
    name,
    label,
    detail,
    time: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }).format(new Date()),
  });
  scannerRecentEntries.splice(30);
  scannerRecentPage = 1;
  renderScannerRecentEntries();
};

const renderScannerNoticeBanner = () => {
  const banner = document.querySelector("#scanner-notice-banner");
  const title = document.querySelector("#scanner-notice-title");
  if (!banner || !title) return;
  const notice = scannerNotices.find((item) => item.isFeatured) || scannerNotices[0];
  banner.hidden = !notice;
  title.textContent = notice?.title || "";
};

// 개인정보 보호 효과는 영상 위의 시각 레이어에만 적용합니다. QR 디코더가 읽는 video 픽셀은 흐리지 않습니다.
const applyScannerPrivacy = () => {
  const reader = document.querySelector("#qr-reader");
  const range = document.querySelector("#scanner-blur-strength");
  const output = document.querySelector("#scanner-blur-output");
  const status = document.querySelector("#scanner-privacy-status");
  if (!reader) return;
  reader.dataset.privacyBlur = scannerPrivacyEnabled ? "on" : "off";
  reader.style.setProperty("--scanner-privacy-blur", `${scannerPrivacyStrength}px`);
  if (range) range.disabled = !scannerPrivacyEnabled;
  if (output) output.textContent = scannerPrivacyEnabled ? `${scannerPrivacyStrength.toFixed(1)}px` : "꺼짐";
  if (status) status.textContent = scannerPrivacyEnabled ? "카메라 화면 개인정보 보호 켜짐" : "카메라 화면 개인정보 보호 꺼짐";
};

const getScanSelection = () => {
  const date = document.querySelector("#scan-meal-date").value;
  const type = document.querySelector('input[name="scan_meal_type"]:checked')?.value;
  if (!date || !type) throw new Error("이용 날짜와 식사 구분을 선택해 주세요.");
  return { date, type };
};

const processUsage = async (profile) => {
  const { date, type } = getScanSelection();
  // 테스트 모드는 운영 DB에 기록하지 않아 중복 제약과 매출 집계에 영향을 주지 않습니다.
  if (scannerTestMode) {
    return { id: `test-${Date.now()}`, userId: profile.id, meal_type: type, type, price: getSelectedScannerPrice(), test_mode: true };
  }
  if (adminMode === "demo") {
    if (demoUsages.some((usage) => usage.userId === profile.id && usage.date === date && usage.type === type)) {
      throw new Error("이미 오늘 사용 처리된 식권입니다.");
    }
    const usage = { id: Date.now(), userId: profile.id, userName: profile.name, affiliation: profile.affiliation, date, type, status: "active", price: type === "breakfast" ? operationalSettings.breakfastPrice : operationalSettings.lunchPrice, createdAt: new Date().toISOString() };
    demoUsages.unshift(usage);
    return usage;
  }
  const { data, error } = await client.rpc("process_meal_usage", { target_qr_token: profile.qr_token, target_meal_type: type, target_meal_date: date });
  if (error) throw new Error(error.message || "식권을 처리하지 못했습니다.");
  return Array.isArray(data) ? data[0] : data;
};

const loadUserUsageCounts = async (profile, date) => {
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEndDate = new Date(`${monthStart}T12:00:00`);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1, 0);
  const monthEnd = formatDateKey(monthEndDate);
  if (adminMode === "demo") {
    const active = demoUsages.filter((usage) => usage.userId === profile.id && usage.status === "active");
    return { monthly: active.filter((usage) => usage.date >= monthStart && usage.date <= monthEnd).length, total: active.length };
  }
  const baseCountQuery = () => client.from("meal_usages").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("status", "active");
  const [monthlyResult, totalResult] = await Promise.all([
    baseCountQuery().gte("meal_date", monthStart).lte("meal_date", monthEnd),
    baseCountQuery(),
  ]);
  if (monthlyResult.error || totalResult.error) throw monthlyResult.error || totalResult.error;
  return { monthly: monthlyResult.count || 0, total: totalResult.count || 0 };
};

const renderScannedProfile = (profile, usage, usageCounts) => {
  const terminal = document.querySelector("#scan-terminal");
  const type = usage.meal_type || usage.type;
  terminal.dataset.state = "success";
  document.querySelector("#scan-terminal-state").textContent = "인증 완료";
  document.querySelector("#scan-terminal-title").innerHTML = `${escapeHtml(profile.name || "사용자")}님,<br />이용이 확인됐어요`;
  document.querySelector("#scan-terminal-description").textContent = "식사 맛있게 드세요";
  document.querySelector("#scan-terminal-user").textContent = profile.name || "사용자";
  document.querySelector("#scan-terminal-monthly").textContent = `${usageCounts.monthly.toLocaleString("ko-KR")}회`;
  document.querySelector("#scan-terminal-total").textContent = `${usageCounts.total.toLocaleString("ko-KR")}회`;
  document.querySelector("#scan-terminal-price").textContent = `${Number(usage.price).toLocaleString("ko-KR")}원 (${mealLabel(type)})`;
  document.querySelector("#scan-terminal-today").textContent = todayScannerUsers.toLocaleString("ko-KR");
  document.querySelector("#scan-today-revenue").textContent = `${todayScannerRevenue.toLocaleString("ko-KR")}원`;
  const notice = document.querySelector("#scan-terminal-notice");
  notice.hidden = false;
  notice.textContent = usage.test_mode
    ? `${profile.affiliation || "소속 미등록"} · 테스트 인증 · 실제 내역 미저장`
    : `${profile.affiliation || "소속 미등록"} · ${mealLabel(type)}`;
  addScannerRecentEntry({ status: "success", name: profile.name || "사용자", label: usage.test_mode ? "테스트 완료" : "인증 완료", detail: `${mealLabel(type)} · ${Number(usage.price).toLocaleString("ko-KR")}원${usage.test_mode ? " · 미저장" : ""}` });
  playSuccessChime();
  renderScannerStatus("처리가 완료되었습니다. 다음 QR을 기다립니다.");
};

const renderDuplicateUsage = (profile, usageCounts) => {
  const { date, type } = getScanSelection();
  const terminal = document.querySelector("#scan-terminal");
  terminal.dataset.state = "duplicate";
  document.querySelector("#scan-terminal-state").textContent = "인증 실패";
  document.querySelector("#scan-terminal-title").innerHTML = `${escapeHtml(profile?.name || "사용자")}님,<br />금일 식권이 이미 사용되었어요`;
  document.querySelector("#scan-terminal-description").textContent = "이미 사용한 QR이에요";
  document.querySelector("#scan-terminal-user").textContent = profile?.name || "사용자";
  document.querySelector("#scan-terminal-monthly").textContent = `${usageCounts.monthly.toLocaleString("ko-KR")}회`;
  document.querySelector("#scan-terminal-total").textContent = `${usageCounts.total.toLocaleString("ko-KR")}회`;
  const notice = document.querySelector("#scan-terminal-notice");
  notice.hidden = false;
  notice.textContent = "관련 문의는 식당 내 관리자를 찾아주세요";
  syncScannerMetrics();
  addScannerRecentEntry({ status: "failure", name: profile?.name || "사용자", label: "인증 실패", detail: `${date} · ${mealLabel(type)}` });
  playScannerFailureChime();
  renderScannerStatus("이미 처리된 식권입니다. 다음 QR을 기다립니다.");
};

const renderScannerFailure = (message) => {
  const terminal = document.querySelector("#scan-terminal");
  terminal.dataset.state = "failure";
  document.querySelector("#scan-terminal-state").textContent = "인증 실패";
  document.querySelector("#scan-terminal-title").textContent = "인증하지 못했어요";
  document.querySelector("#scan-terminal-description").textContent = message || "QR을 다시 스캔해 주세요";
  document.querySelector("#scan-terminal-user").textContent = "-";
  document.querySelector("#scan-terminal-monthly").textContent = "-";
  document.querySelector("#scan-terminal-total").textContent = "-";
  const notice = document.querySelector("#scan-terminal-notice");
  notice.hidden = false;
  notice.textContent = "QR을 다시 스캔해 주세요";
  addScannerRecentEntry({ status: "failure", name: "인증되지 않음", label: "인증 실패", detail: message || "QR 확인 필요" });
  playScannerFailureChime();
};

const handleDecodedToken = async (token) => {
  renderScannerStatus("QR을 확인하고 있어요.");
  let profile = null;
  try {
    profile = await findProfileByToken(token.trim());
    renderScannerStatus("정기권 이용 기록을 저장하고 있어요.");
    const { date } = getScanSelection();
    const usage = await processUsage(profile);
    const [, usageCounts] = await Promise.all([
      usage.test_mode ? Promise.resolve() : refreshDashboard(),
      loadUserUsageCounts(profile, date),
    ]);
    renderScannedProfile(profile, usage, usageCounts);
    return "success";
  } catch (error) {
    if (isDuplicateMealUsageError(error)) {
      const usageCounts = profile ? await loadUserUsageCounts(profile, getScanSelection().date).catch(() => ({ monthly: 0, total: 0 })) : { monthly: 0, total: 0 };
      renderDuplicateUsage(profile, usageCounts);
      return "duplicate";
    }
    renderScannerFailure(error.message || "QR을 처리하지 못했습니다.");
    renderScannerStatus(error.message || "QR을 처리하지 못했습니다.", true);
    return "error";
  }
};

const startScanner = async () => {
  const start = document.querySelector("#scanner-start");
  const stop = document.querySelector("#scanner-stop");
  start.disabled = true;
  try {
    const Html5Qrcode = await loadScannerLibrary();
    document.querySelector("#qr-reader").innerHTML = "";
    qrScanner = new Html5Qrcode("qr-reader");
    // 흰색 네모는 위치 안내용으로만 표시하고, 디코더는 카메라 프레임 전체에서 QR을 찾습니다.
    await qrScanner.start({ facingMode: "environment" }, { fps: 15 }, async (text) => {
      if (scanBusy) return;
      scanBusy = true;
      const outcome = await handleDecodedToken(text);
      window.setTimeout(() => {
        renderScannerReady();
        renderScannerStatus("QR 인식을 기다리고 있어요.");
        scanBusy = false;
      }, outcome === "duplicate" ? 5000 : 4000);
    }, () => {});
    document.body.classList.add("scanner-is-active");
    stop.disabled = false;
    renderScannerStatus("QR 인식을 기다리고 있어요.");
  } catch (error) {
    start.disabled = false;
    document.querySelector("#qr-reader").innerHTML = `<div class="scanner-placeholder"><span>!</span><p>${escapeHtml(error.message || "카메라를 시작하지 못했습니다.")}</p></div>`;
  }
};

document.querySelector("#scanner-start").addEventListener("click", async () => {
  await prepareScannerAudio();
  await startScanner();
});

document.querySelector("#scanner-stop").addEventListener("click", stopScanner);
document.querySelector("#scan-use-current").addEventListener("click", setScanDefaults);
document.querySelector("#scan-meal-date").addEventListener("change", renderScannerMeal);
document.querySelectorAll('input[name="scan_meal_type"]').forEach((input) => input.addEventListener("change", () => {
  syncScannerMetrics();
  renderScannerMeal();
}));
document.querySelector("#scanner-test-mode").addEventListener("change", (event) => {
  scannerTestMode = event.currentTarget.checked;
  document.querySelector(".scanner-kiosk").classList.toggle("is-test-mode", scannerTestMode);
  document.querySelector("#scanner-test-indicator").hidden = !scannerTestMode;
  renderScannerReady();
  renderScannerStatus(scannerTestMode
    ? "테스트 모드가 켜졌어요. 반복 인식 결과는 실제 내역에 저장되지 않습니다."
    : "운영 모드로 돌아왔어요. QR 인식을 기다리고 있어요.");
});
document.querySelector("#scanner-privacy-enabled").addEventListener("change", (event) => {
  scannerPrivacyEnabled = event.currentTarget.checked;
  applyScannerPrivacy();
});
document.querySelector("#scanner-blur-strength").addEventListener("input", (event) => {
  scannerPrivacyStrength = Number(event.currentTarget.value) || 1.2;
  applyScannerPrivacy();
});
document.querySelector("#scanner-recent-pagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-scanner-recent-page]");
  if (!button || button.disabled) return;
  scannerRecentPage = Number(button.dataset.scannerRecentPage) || 1;
  renderScannerRecentEntries();
});

const scannerOperationsDialog = document.querySelector("#scanner-operations-dialog");
const scannerExitDialog = document.querySelector("#scanner-exit-dialog");
document.querySelector("#scanner-details-open").addEventListener("click", () => scannerOperationsDialog.showModal());
document.querySelector("#scanner-details-close").addEventListener("click", () => scannerOperationsDialog.close());
document.querySelector("#scanner-exit-open").addEventListener("click", () => scannerExitDialog.showModal());
document.querySelector("#scanner-exit-cancel").addEventListener("click", () => scannerExitDialog.close());
document.querySelector("#scanner-exit-confirm").addEventListener("click", () => {
  scannerExitDialog.close();
  location.hash = "#dashboard";
});
[scannerOperationsDialog, scannerExitDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

// ── 사용자·운영 설정·이용 기록 관리 ─────────────────────────────────────
const userTypeLabel = (type) => ({ student: "학생", faculty: "교원", staff: "직원", other: "기타" })[type] || "기타";

const renderUsers = async () => {
  const target = document.querySelector("#user-admin-list");
  const summary = document.querySelector("#user-admin-summary");
  if (!target) return;
  if (adminMode !== "supabase") {
    summary.innerHTML = "";
    target.innerHTML = '<div class="scan-empty"><span>운영 데이터 연결이 필요합니다.</span></div>';
    return;
  }
  target.innerHTML = '<p class="usage-admin-loading">사용자를 불러오고 있어요.</p>';
  const formData = new FormData(document.querySelector("#user-search-form"));
  const status = formData.get("status");
  const { data, error } = await client.rpc("admin_search_profiles", {
    search_query: String(formData.get("query") || "").trim() || null,
    active_filter: status === "all" ? null : status === "active",
  });
  if (error) {
    summary.innerHTML = "";
    target.innerHTML = `<p class="usage-admin-loading is-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data?.length) {
    summary.innerHTML = '<span><strong>0</strong>검색 결과</span>';
    target.innerHTML = '<div class="scan-empty"><span>조건에 맞는 사용자가 없습니다.</span></div>';
    return;
  }
  const activeCount = data.filter((profile) => profile.is_active).length;
  const adminCount = data.filter((profile) => profile.role === "admin").length;
  summary.innerHTML = `<span><strong>${data.length.toLocaleString("ko-KR")}</strong>검색 결과</span><span><strong>${activeCount.toLocaleString("ko-KR")}</strong>활성 계정</span><span><strong>${adminCount.toLocaleString("ko-KR")}</strong>관리자</span>`;
  target.innerHTML = data.map((profile) => {
    const isSelf = profile.id === currentUserId;
    return `<form class="user-admin-item" data-user-id="${escapeHtml(profile.id)}">
      <div class="user-admin-person"><div class="scanned-profile__avatar">${escapeHtml(profile.name?.[0] || "밥")}</div><div><strong>${escapeHtml(profile.name || "이름 미등록")}</strong><span>${escapeHtml(profile.affiliation || "소속 미등록")} · ${userTypeLabel(profile.user_type)}</span>${isSelf ? '<span class="user-admin-self">현재 로그인한 관리자 계정</span>' : ""}</div></div>
      <label>소속<input name="affiliation" value="${escapeHtml(profile.affiliation || "")}" placeholder="소속 미등록" /></label>
      <label>사용자 유형<select name="user_type"><option value="student"${profile.user_type === "student" ? " selected" : ""}>학생</option><option value="faculty"${profile.user_type === "faculty" ? " selected" : ""}>교원</option><option value="staff"${profile.user_type === "staff" ? " selected" : ""}>직원</option><option value="other"${profile.user_type === "other" ? " selected" : ""}>기타</option></select></label>
      <label>권한<select name="role"${isSelf ? " disabled" : ""}><option value="user"${profile.role === "user" ? " selected" : ""}>일반 사용자</option><option value="admin"${profile.role === "admin" ? " selected" : ""}>관리자</option></select>${isSelf ? '<input type="hidden" name="role" value="admin" />' : ""}</label>
      <label class="user-active"><input name="is_active" type="checkbox"${profile.is_active ? " checked" : ""}${isSelf ? " disabled" : ""} /><span>${profile.is_active ? "활성" : "비활성"}</span>${isSelf ? '<input type="hidden" name="self_active" value="true" />' : ""}</label>
      <button class="secondary-button" type="submit">저장</button>
      <p class="user-admin-message" role="status"></p>
    </form>`;
  }).join("");
  target.querySelectorAll("select").forEach(enhanceAdminSelect);

  target.querySelectorAll(".user-admin-item").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector(".user-admin-message");
    const button = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    button.disabled = true;
    message.textContent = "저장 중…";
    try {
      const { error: updateError } = await client.rpc("admin_update_profile", {
        target_user_id: form.dataset.userId,
        target_role: values.get("role"),
        target_user_type: values.get("user_type"),
        target_affiliation: String(values.get("affiliation") || "").trim() || null,
        target_is_active: values.has("is_active") || values.has("self_active"),
      });
      if (updateError) throw updateError;
      message.classList.remove("is-error");
      message.textContent = "저장됨";
      await renderUsers();
    } catch (updateError) {
      message.classList.add("is-error");
      message.textContent = updateError.message || "사용자 정보를 저장하지 못했습니다.";
    } finally {
      button.disabled = false;
    }
  }));
};

const renderSettings = () => {
  const form = document.querySelector("#settings-form");
  if (!form) return;
  form.elements.breakfast_start.value = operationalSettings.breakfastStart;
  form.elements.breakfast_end.value = operationalSettings.breakfastEnd;
  form.elements.lunch_start.value = operationalSettings.lunchStart;
  form.elements.lunch_end.value = operationalSettings.lunchEnd;
  form.elements.scan_buffer_minutes.value = operationalSettings.scanBufferMinutes;
  form.elements.breakfast_price.value = operationalSettings.breakfastPrice;
  form.elements.lunch_price.value = operationalSettings.lunchPrice;
  form.querySelector("button[type=submit]").disabled = adminMode !== "supabase";
  syncFoodImageManagerVisibility();
};

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
  createdAt: record.created_at || record.createdAt || null,
});

const formatUsageDateTime = (usage) => {
  if (!usage.createdAt) return usage.date;
  const parsed = new Date(usage.createdAt);
  if (Number.isNaN(parsed.getTime())) return usage.date;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(parsed);
};

const updateUsage = async (usageId, date, type, status, note) => {
  if (adminMode === "demo") {
    const usage = demoUsages.find((item) => String(item.id) === String(usageId));
    if (!usage) throw new Error("이용 기록을 찾을 수 없습니다.");
    const conflict = status === "active" && demoUsages.some((item) => item !== usage && item.userId === usage.userId && item.date === date && item.type === type && item.status === "active");
    if (conflict) throw new Error("같은 날짜·식사 이용 기록이 이미 있습니다.");
    Object.assign(usage, { date, type, status, note, price: type === "breakfast" ? operationalSettings.breakfastPrice : operationalSettings.lunchPrice });
    return;
  }
  const { error } = await client.rpc("admin_update_meal_usage", {
    target_usage_id: Number(usageId), target_meal_date: date, target_meal_type: type, target_status: status, note: note || null,
  });
  if (error) throw new Error(error.message || "이용 기록을 수정하지 못했습니다.");
};

const getMonthRange = (month) => {
  const start = `${month}-01`;
  const next = new Date(`${start}T12:00:00`);
  next.setMonth(next.getMonth() + 1, 1);
  return { start, end: dateKey(next) };
};

const renderUsages = async () => {
  const target = document.querySelector("#usage-admin-list");
  const form = document.querySelector("#usage-filter-form");
  const mode = form.elements.period_mode.value;
  const selectedDate = mode === "day" ? form.elements.date.value : "";
  const selectedMonth = mode === "month" ? form.elements.month.value : "";
  const summary = document.querySelector("#usage-filter-summary");
  const financeSummary = document.querySelector("#usage-finance-summary");
  if (!target) return;
  target.innerHTML = '<p class="usage-admin-loading">이용 내역을 불러오고 있어요.</p>';
  const todayMonth = monthKey(getSeoulDate());
  const currentRange = getMonthRange(todayMonth);
  let allDemoRecords = demoUsages.map(normalizeUsage);
  let records = allDemoRecords.filter((usage) => {
    if (selectedDate) return usage.date === selectedDate;
    if (selectedMonth) return usage.date.startsWith(selectedMonth);
    return true;
  });
  let currentMonthTotal = allDemoRecords
    .filter((usage) => usage.status === "active" && usage.date >= currentRange.start && usage.date < currentRange.end)
    .reduce((sum, usage) => sum + usage.price, 0);
  if (adminMode === "supabase") {
    let query = client.from("meal_usages")
      .select("id, user_id, meal_date, meal_type, price, status, correction_note, created_at, profiles!meal_usages_user_id_fkey(name, affiliation)")
      .order("created_at", { ascending: false }).limit(500);
    if (selectedDate) query = query.eq("meal_date", selectedDate);
    if (selectedMonth) {
      const range = getMonthRange(selectedMonth);
      query = query.gte("meal_date", range.start).lt("meal_date", range.end);
    }
    const currentMonthQuery = client.from("meal_usages")
      .select("price, status")
      .gte("meal_date", currentRange.start)
      .lt("meal_date", currentRange.end);
    const [recordsResult, currentMonthResult] = await Promise.all([query, currentMonthQuery]);
    if (recordsResult.error || currentMonthResult.error) {
      const error = recordsResult.error || currentMonthResult.error;
      target.innerHTML = `<p class="usage-admin-loading is-error">${escapeHtml(error.message)}</p>`;
      return;
    }
    records = (recordsResult.data ?? []).map(normalizeUsage);
    currentMonthTotal = (currentMonthResult.data ?? [])
      .filter((usage) => usage.status === "active")
      .reduce((sum, usage) => sum + Number(usage.price || 0), 0);
  }
  const activeRecords = records.filter((usage) => usage.status === "active");
  const periodTotal = activeRecords.reduce((sum, usage) => sum + usage.price, 0);
  const periodLabel = selectedDate || (selectedMonth ? `${selectedMonth.slice(0, 4)}년 ${Number(selectedMonth.slice(5, 7))}월` : "전체");
  const periodRevenueLabel = selectedMonth ? `${Number(selectedMonth.slice(5, 7))}월 매출액 총계` : (selectedDate ? "선택일 이용금액" : "조회 이용금액");
  summary.textContent = `${periodLabel} 이용 기록 ${records.length.toLocaleString("ko-KR")}건`;
  financeSummary.innerHTML = `<div><span>조회 기록</span><strong>${records.length.toLocaleString("ko-KR")}건</strong><small>정상 ${activeRecords.length.toLocaleString("ko-KR")}건</small></div><div><span>${periodRevenueLabel}</span><strong>${periodTotal.toLocaleString("ko-KR")}원</strong><small>취소 기록 제외</small></div><div><span>${Number(todayMonth.slice(5, 7))}월 매출액</span><strong>${currentMonthTotal.toLocaleString("ko-KR")}원</strong><small>이번 달 정상 이용 합계</small></div>`;
  if (!records.length) {
    target.innerHTML = '<div class="scan-empty"><span>아직 이용 기록이 없습니다.</span><p>QR을 인식하면 바로 이곳에 표시됩니다.</p></div>';
    return;
  }
  target.innerHTML = records.map((usage) => `<form class="usage-admin-item" data-usage-id="${usage.id}">
    <div class="usage-admin-person"><strong>${escapeHtml(usage.userName)}</strong><span>${escapeHtml(usage.affiliation)} · ${escapeHtml(formatUsageDateTime(usage))}</span></div>
    <div class="usage-admin-price${usage.status === "cancelled" ? " is-cancelled" : ""}"><span>이용금액</span><strong>${usage.price.toLocaleString("ko-KR")}원</strong></div>
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
      await refreshDashboard();
      await renderUsages();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("is-error");
    } finally {
      button.disabled = false;
    }
  }));
};

document.querySelector("#usage-refresh").addEventListener("click", renderUsages);
document.querySelector("#usage-filter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  renderUsages();
});
document.querySelector("#usage-filter-clear").addEventListener("click", () => {
  document.querySelector("#usage-filter-form").reset();
  document.querySelector('#usage-filter-form input[name="date"]')._refreshAdminDate?.();
  renderUsages();
});
document.querySelector("#user-refresh").addEventListener("click", renderUsers);
document.querySelector("#user-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  renderUsers();
});
document.querySelector("#user-search-form").elements.status.addEventListener("change", renderUsers);
document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (adminMode !== "supabase") return;
  const form = event.currentTarget;
  const values = new FormData(form);
  const message = document.querySelector("#settings-message");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  message.textContent = "저장 중…";
  try {
    const payload = {
      breakfast_start: values.get("breakfast_start"), breakfast_end: values.get("breakfast_end"),
      lunch_start: values.get("lunch_start"), lunch_end: values.get("lunch_end"),
      scan_buffer_minutes: Number(values.get("scan_buffer_minutes")),
    };
    const { error } = await client.rpc("admin_update_operating_settings", payload);
    if (error) throw error;
    const { error: priceError } = await client.rpc("admin_update_pricing_settings", {
      breakfast_price: Number(values.get("breakfast_price")),
      lunch_price: Number(values.get("lunch_price")),
    });
    if (priceError) throw priceError;
    await loadOperationalSettings();
    syncFoodImageManagerVisibility();
    setScanDefaults();
    message.textContent = "운영 설정을 저장했습니다.";
  } catch (error) {
    message.textContent = error.message || "설정을 저장하지 못했습니다.";
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#menu-sync").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const target = document.querySelector("#menu-import-status");
  if (adminMode !== "supabase") return;
  button.disabled = true;
  button.textContent = "가져오는 중…";
  target.classList.remove("is-error");
  target.innerHTML = "<p>이번 주 식단을 가져오고 있습니다.</p>";
  try {
    const { data, error } = await client.functions.invoke("import-yeongjun-menu", { body: { trigger: "manual" } });
    if (error) throw new Error(await getFunctionErrorMessage(error, data, "식단 최신화 요청을 처리하지 못했습니다."));
    await loadDatabaseMeals();
    renderStats();
    renderMeals();
    target.innerHTML = `<p><strong>${escapeHtml(data.period.from)} ~ ${escapeHtml(data.period.to)} 최신화 완료</strong></p><div class="import-status__meta"><span>신규 ${data.insertedCount}건</span><span>변경 ${data.updatedCount}건</span><span>동일 ${data.unchangedCount}건</span><span>수동 보호 ${data.protectedCount}건</span></div>`;
  } catch (error) {
    const message = String(error.message || "");
    if (/이미 식단 최신화가 진행 중/.test(message)) {
      target.innerHTML = '<p><strong>식단 최신화가 진행 중입니다.</strong> · 기존 요청이 완료된 뒤 새로고침해주세요.</p>';
    } else {
      target.classList.add("is-error");
      const friendlyMessage = /이번 주 기준으로 갱신되지 않았|연속되지 않|평일 날짜/.test(message)
        ? "원본 식단에 새로운 변경사항이 없어 최신 식단을 불러오지 못했습니다."
        : /원본 식단 서버|fetch|시간을 초과/.test(message)
          ? "식단 원본 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요."
          : message || "식단을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      target.innerHTML = `<p><strong>최신화 실패</strong> · ${escapeHtml(friendlyMessage)}</p>`;
    }
  } finally {
    button.disabled = false;
    button.textContent = "지금 가져오기";
  }
});

// ── 관리자 이벤트 바인딩과 식단 저장 ────────────────────────────────────
// 저장 전 getManualMealState에서 제공/미제공/휴무 상태를 정규화해 빈 제공 식단을 차단합니다.
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
  const { data } = await client.from("meals").select("id, meal_date, meal_type, is_published, is_operating, admin_note, meal_tray_images(id, storage_path, image_url, alt_text), meal_items(display_order, original_menu_text)").order("meal_date", { ascending: false });
  meals = (data ?? []).map(mapDatabaseMeal);
};

document.querySelector("#admin-menu-button").addEventListener("click", () => {
  const sidebar = document.querySelector(".admin-sidebar");
  const open = !sidebar.classList.contains("is-open");
  sidebar.classList.toggle("is-open", open);
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", String(open));
});
document.querySelector("#admin-menu-close").addEventListener("click", () => {
  document.querySelector(".admin-sidebar").classList.remove("is-open");
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", "false");
});

document.querySelector("#tray-image-meal").addEventListener("change", () => {
  document.querySelector("#tray-image-file").value = "";
  document.querySelector("#tray-image-message").textContent = "";
  renderTrayImageManager();
});

document.querySelector("#tray-image-file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  const preview = document.querySelector("#tray-image-preview");
  if (!file) {
    renderTrayImageManager();
    return;
  }
  if (!file.type.startsWith("image/")) {
    event.target.value = "";
    document.querySelector("#tray-image-message").textContent = "이미지 파일만 선택할 수 있습니다.";
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  preview.classList.add("has-image");
  preview.innerHTML = `<img src="${escapeHtml(previewUrl)}" alt="업로드할 식판 이미지 미리보기" /><span>업로드할 이미지 미리보기</span>`;
  preview.querySelector("img").addEventListener("load", () => URL.revokeObjectURL(previewUrl), { once: true });
});

document.querySelector("#tray-image-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = document.querySelector("#tray-image-message");
  const file = form.elements.tray_image.files?.[0];
  const meal = meals.find((item) => String(item.id) === String(form.elements.meal_id.value));
  if (adminMode !== "supabase" || !meal || !file) return;
  if (file.size > 10 * 1024 * 1024) {
    message.textContent = "10MB 이하 이미지를 선택해주세요.";
    return;
  }
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = extensions[file.type];
  if (!extension) {
    message.textContent = "JPG, PNG 또는 WebP 이미지만 업로드할 수 있습니다.";
    return;
  }
  const storagePath = `${meal.date}/${meal.type}-${meal.id}-${Date.now()}.${extension}`;
  button.disabled = true;
  message.textContent = "식판 이미지를 업로드하고 있습니다…";
  try {
    const { error: uploadError } = await client.storage.from("meal-tray-images").upload(storagePath, file, {
      contentType: file.type, cacheControl: "31536000", upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: publicUrlData } = client.storage.from("meal-tray-images").getPublicUrl(storagePath);
    const { error: saveError } = await client.from("meal_tray_images").upsert({
      meal_id: meal.id,
      storage_path: storagePath,
      image_url: publicUrlData.publicUrl,
      alt_text: `${meal.date} ${mealLabel(meal.type)}: ${meal.items.join(", ")}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: "meal_id" });
    if (saveError) {
      await client.storage.from("meal-tray-images").remove([storagePath]);
      throw saveError;
    }
    await loadDatabaseMeals();
    renderMeals();
    form.elements.meal_id.value = String(meal.id);
    renderTrayImageManager();
    form.elements.tray_image.value = "";
    message.textContent = `${meal.date} ${mealLabel(meal.type)} 고정 식판 이미지를 저장했습니다.`;
  } catch (error) {
    message.textContent = error.message || "식판 이미지를 저장하지 못했습니다.";
  } finally {
    button.disabled = false;
  }
});

window.addEventListener("hashchange", () => route(location.hash.slice(1)));
document.querySelector("#meal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = document.querySelector("#meal-form-message");
  const data = new FormData(form);
  let state;
  try {
    state = getManualMealState(data.get("availability"), String(data.get("menu_items") || "").split(/\r?\n/), data.get("closure_note"));
  } catch (error) {
    message.textContent = error.message;
    return;
  }
  button.disabled = true;
  message.textContent = "저장 중…";
  try {
    await saveMeal({
      mealDate: data.get("meal_date"), mealType: data.get("meal_type"), menuItems: state.menuItems,
      adminNote: state.adminNote, isOperating: state.isOperating, isPublished: true,
    });
    mealListPage = 1;
    message.textContent = adminMode === "demo" ? "시연 목록에 반영했습니다. 실제 DB에는 저장되지 않았습니다." : "식단을 저장했습니다.";
    form.elements.menu_items.value = "";
    renderStats();
    renderMeals();
  } catch (error) {
    message.textContent = error.message || "식단을 저장하지 못했습니다.";
  } finally {
    button.disabled = false;
  }
});

const syncMealAvailability = () => {
  const form = document.querySelector("#meal-form");
  const availability = form.elements.availability.value;
  const provided = availability === "provided";
  document.querySelector("#meal-menu-field").hidden = !provided;
  document.querySelector("#meal-closure-field").hidden = !shouldShowClosureReason(availability);
  form.elements.menu_items.required = provided;
  form.elements.closure_note.required = false;
};
document.querySelector("#meal-form").elements.availability.addEventListener("change", syncMealAvailability);
syncMealAvailability();

document.querySelector("#food-image-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = document.querySelector("#food-image-message");
  const foodName = form.elements.food_name.value;
  if (!foodName) return;
  foodImageBrowsingStarted = true;
  const nextSearchPage = (foodImageSearchPages.get(foodName) || 0) % 10 + 1;
  button.disabled = true;
  message.textContent = "대체 사진을 찾고 있습니다…";
  try {
    await loadFoodImageCandidates(foodName, nextSearchPage);
    message.textContent = `${foodName}의 ${nextSearchPage}번째 사진 후보 묶음을 불러왔습니다.`;
  } catch (error) {
    message.textContent = error.message || "사진 후보를 불러오지 못했습니다.";
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-food-image-list]").forEach((filterButton) => filterButton.addEventListener("click", async () => {
  foodImageListMode = filterButton.dataset.foodImageList;
  foodImageMenuIndex = 0;
  foodImageEditTarget = null;
  refreshFoodImageMenuList();
  if (foodImageListMode === "saved") {
    renderSavedFoodImageGrid();
    document.querySelector("#food-image-message").textContent = "확정 저장한 대표 사진을 메뉴별로 모아 보여드립니다.";
    return;
  }
  const foodName = document.querySelector("#food-image-menu").value;
  if (!foodName) {
    document.querySelector("#food-image-workspace").innerHTML = `<div class="food-image-empty"><strong>${foodImageListMode === "saved" ? "아직 확정 저장한 사진이 없습니다." : "모든 메뉴 사진을 설정했습니다."}</strong></div>`;
    return;
  }
  if (!foodImageBrowsingStarted) return;
  const message = document.querySelector("#food-image-message");
  message.textContent = `${foodName} 사진을 불러오고 있습니다…`;
  try {
    await loadFoodImageCandidates(foodName, foodImageSearchPages.get(foodName) || 1);
    message.textContent = `${foodName} 사진 후보를 불러왔습니다.`;
  } catch (error) {
    message.textContent = error.message || "사진 후보를 불러오지 못했습니다.";
  }
}));

document.querySelector("#saved-food-image-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-unselect-food-image]");
  if (!button) return;
  const image = savedFoodImages.find((item) => String(item.id) === button.dataset.unselectFoodImage);
  if (!image) return;
  button.disabled = true;
  const message = document.querySelector("#food-image-message");
  message.textContent = `${image.foodName} 사진의 저장 상태를 해제하고 있습니다…`;
  try {
    const { error } = await client.from("food_images").update({ reviewed_by: null, reviewed_at: null }).eq("id", image.id);
    if (error) throw error;
    await loadSavedFoodImageNames();
    foodImageListMode = "pending";
    foodImageMenuIndex = 0;
    refreshFoodImageMenuList(image.foodName);
    foodImageEditTarget = null;
    foodImageBrowsingStarted = true;
    await loadFoodImageCandidates(image.foodName, foodImageSearchPages.get(image.foodName) || 1);
    message.textContent = `${image.foodName}을 미설정 메뉴로 옮겼습니다. 새 사진을 선택해 다시 저장해주세요.`;
  } catch (error) {
    message.textContent = error.message || "저장 상태를 해제하지 못했습니다.";
    button.disabled = false;
  }
});

const browseFoodImageMenu = async (direction) => {
  if (!foodImageMenuNames.length) return;
  foodImageMenuIndex = (foodImageMenuIndex + direction + foodImageMenuNames.length) % foodImageMenuNames.length;
  updateFoodImageMenuNavigator();
  foodImageEditTarget = null;
  if (!foodImageBrowsingStarted) return;
  const foodName = document.querySelector("#food-image-menu").value;
  const message = document.querySelector("#food-image-message");
  const navigationButtons = [document.querySelector("#food-image-prev"), document.querySelector("#food-image-next")];
  navigationButtons.forEach((button) => { button.disabled = true; });
  message.textContent = `${foodName} 사진을 불러오고 있습니다…`;
  try {
    const searchPage = foodImageSearchPages.get(foodName) || 1;
    await loadFoodImageCandidates(foodName, searchPage);
    message.textContent = `${foodName} 사진 후보를 불러왔습니다.`;
  } catch (error) {
    message.textContent = error.message || "사진 후보를 불러오지 못했습니다.";
  } finally {
    navigationButtons.forEach((button) => { button.disabled = foodImageMenuNames.length < 2; });
  }
};

document.querySelector("#food-image-prev").addEventListener("click", () => browseFoodImageMenu(-1));
document.querySelector("#food-image-next").addEventListener("click", () => browseFoodImageMenu(1));

document.querySelector("#food-image-workspace").addEventListener("input", (event) => {
  const input = event.target.closest("[data-crop-control]");
  if (!input || !foodImageEditTarget) return;
  foodImageEditTarget[input.dataset.cropControl] = Number(input.value);
  const preview = document.querySelector(".food-image-editor__preview img");
  if (preview) {
    const crop = getPreviewCrop(foodImageEditTarget);
    preview.style.setProperty("--preview-zoom", crop.zoom);
    preview.style.setProperty("--preview-shift-x", `${crop.shiftX}%`);
    preview.style.setProperty("--preview-shift-y", `${crop.shiftY}%`);
  }
  const outputIds = { cropZoom: "#food-image-zoom-value", focalX: "#food-image-x-value", focalY: "#food-image-y-value" };
  const suffix = input.dataset.cropControl === "cropZoom" ? "배" : "%";
  const output = document.querySelector(outputIds[input.dataset.cropControl]);
  if (output) output.textContent = `${input.dataset.cropControl === "cropZoom" ? Number(input.value).toFixed(2) : input.value}${suffix}`;
});

document.querySelector("#food-image-workspace").addEventListener("click", async (event) => {
  const candidateButton = event.target.closest("[data-image-candidate]");
  if (candidateButton) {
    const candidate = foodImageCandidates[Number(candidateButton.dataset.imageCandidate)];
    if (!candidate || !foodImageWorkspaceData) return;
    foodImageEditTarget = { ...candidate, foodId: foodImageWorkspaceData.food.id, cropZoom: 1.08, focalX: 50, focalY: 50 };
    renderFoodImageWorkspace(foodImageWorkspaceData);
    document.querySelector(".food-image-editor")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  const button = event.target.closest("[data-save-food-image]");
  if (!button || !foodImageEditTarget) return;
  const foodName = document.querySelector("#food-image-menu").value;
  const message = document.querySelector("#food-image-message");
  if (!foodName) return;
  button.disabled = true;
  message.textContent = "대표 사진과 구도를 저장하고 있습니다…";
  try {
    const { data, error } = await client.functions.invoke("manage-food-image", {
      body: {
        action: "select",
        foodName,
        selectionToken: foodImageEditTarget.selectionToken,
        cropZoom: foodImageEditTarget.cropZoom,
        focalX: foodImageEditTarget.focalX,
        focalY: foodImageEditTarget.focalY,
      },
    });
    if (error) throw new Error(await getFunctionErrorMessage(error, data, "대표 사진을 저장하지 못했습니다. 사진을 다시 검색해주세요."));
    await loadSavedFoodImageNames();
    foodImageEditTarget = null;
    await loadFoodImageCandidates(foodName, foodImageSearchPages.get(foodName) || 1);
    refreshFoodImageMenuList(foodName);
    message.textContent = `${foodName} 대표 사진과 구도를 저장했습니다. 사용자 식판에서 계속 재사용됩니다.`;
  } catch (error) {
    message.textContent = error.message || "대표 사진을 저장하지 못했습니다.";
    button.disabled = false;
  }
});

document.querySelector("#meal-form").elements.meal_date.value = formatDateKey(getSeoulDate());
document.querySelectorAll("#user-search-form select").forEach(enhanceAdminSelect);
enhanceUsageDatePicker();
const accessAllowed = await initializeAdmin();
if (accessAllowed !== false) {
  await initAdminCommunity({
    client,
    mode: adminMode,
    currentUserId,
    onNoticesChange: (items) => {
      scannerNotices = items;
      renderScannerNoticeBanner();
    },
    onSuggestionsChange: (items) => {
      dashboardSuggestions = items;
      renderStats();
    },
  });
  applyScannerPrivacy();
  renderScannerRecentEntries();
  updateScannerClock();
  window.setInterval(updateScannerClock, 15_000);
  setScanDefaults();
  route(location.hash.slice(1));
  await refreshDashboard();
  renderMeals();
  await renderImportStatus();
}
