import { formatDateKey, getSeoulDate, sampleMeals } from "./sample-data.js";
import { getSupabaseClient } from "./supabase-client.js";
import { defaultOperationalSettings, getAutomaticMealType } from "./admin-utils.js";

const titles = { dashboard: "대시보드", meals: "식단 관리", scanner: "QR 스캐너", users: "사용자 관리", usages: "이용 내역", settings: "운영 설정" };
let adminMode = "demo";
let meals = [...sampleMeals];
let client = null;
let qrScanner = null;
let currentUserId = null;
let operationalSettings = { ...defaultOperationalSettings };
let scannerAudioContext = null;
let scanBusy = false;
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

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const route = (nextRoute) => {
  const safe = titles[nextRoute] ? nextRoute : "dashboard";
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

const adminMealStatus = (meal) => {
  if (meal.operating === false) return { label: "휴무", kind: "closed" };
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
    ? "Kakao와 Google 이미지 후보를 함께 보여드리고 있습니다."
    : "현재 Kakao 이미지 후보를 보여드리고 있습니다. Google 검색 API 연결 시 Google 후보도 함께 표시됩니다.";
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
  const [{ data: hours }, { data: prices }, { data: trayMode }] = await Promise.all([
    client.from("app_settings").select("setting_value").eq("setting_key", "meal_hours").single(),
    client.from("app_settings").select("setting_value").eq("setting_key", "meal_prices").single(),
    client.from("app_settings").select("setting_value").eq("setting_key", "tray_display_mode").maybeSingle(),
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
    trayDisplayMode: trayMode?.setting_value?.mode === "ai" ? "ai" : "search",
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
  return true;
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

const renderScannerStatus = (message, isError = false) => {
  document.querySelector("#scan-result").innerHTML = `<div class="scan-kiosk-status${isError ? " is-error" : ""}"><span class="scan-kiosk-status__dot"></span><strong>${escapeHtml(message)}</strong></div>`;
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
};

const getScanSelection = () => {
  const date = document.querySelector("#scan-meal-date").value;
  const type = document.querySelector('input[name="scan_meal_type"]:checked')?.value;
  if (!date || !type) throw new Error("이용 날짜와 식사 구분을 선택해 주세요.");
  return { date, type };
};

const processUsage = async (profile) => {
  const { date, type } = getScanSelection();
  if (adminMode === "demo") {
    if (demoUsages.some((usage) => usage.userId === profile.id && usage.date === date && usage.type === type)) {
      throw new Error("이미 사용 처리된 식권입니다.");
    }
    const usage = { id: Date.now(), userId: profile.id, userName: profile.name, affiliation: profile.affiliation, date, type, status: "active", price: type === "breakfast" ? operationalSettings.breakfastPrice : operationalSettings.lunchPrice };
    demoUsages.unshift(usage);
    return usage;
  }
  const { data, error } = await client.rpc("process_meal_usage", { target_qr_token: profile.qr_token, target_meal_type: type, target_meal_date: date });
  if (error) throw new Error(error.message || "식권을 처리하지 못했습니다.");
  return Array.isArray(data) ? data[0] : data;
};

const renderScannedProfile = (profile, usage) => {
  const overlay = document.querySelector("#scan-success");
  document.querySelector("#scan-success-detail").textContent = `${mealLabel(usage.meal_type || usage.type)} · ${Number(usage.price).toLocaleString("ko-KR")}원`;
  overlay.hidden = false;
  playSuccessChime();
  renderScannerStatus("처리가 완료되었습니다. 다음 QR을 기다립니다.");
};

const handleDecodedToken = async (token) => {
  renderScannerStatus("QR을 확인하고 있어요.");
  try {
    const profile = await findProfileByToken(token.trim());
    renderScannerStatus("정기권 이용 기록을 저장하고 있어요.");
    const usage = await processUsage(profile);
    renderScannedProfile(profile, usage);
    renderStats();
    return true;
  } catch (error) {
    renderScannerStatus(error.message || "QR을 처리하지 못했습니다.", true);
    return false;
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
    const boxSize = Math.max(240, Math.min(420, window.innerWidth - 90));
    await qrScanner.start({ facingMode: "environment" }, { fps: 12, qrbox: { width: boxSize, height: boxSize } }, async (text) => {
      if (scanBusy) return;
      scanBusy = true;
      await stopScanner();
      const succeeded = await handleDecodedToken(text);
      window.setTimeout(async () => {
        document.querySelector("#scan-success").hidden = true;
        scanBusy = false;
        if (location.hash === "#scanner") await startScanner();
      }, succeeded ? 1600 : 1400);
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
document.querySelector("#manual-token-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await prepareScannerAudio();
  const succeeded = await handleDecodedToken(new FormData(event.currentTarget).get("qr_token"));
  if (succeeded) window.setTimeout(() => {
    document.querySelector("#scan-success").hidden = true;
    renderScannerStatus("스캔을 기다리고 있어요.");
  }, 1600);
});

const userTypeLabel = (type) => ({ student: "학생", faculty: "교원", staff: "직원", other: "기타" })[type] || "기타";

const renderUsers = async () => {
  const target = document.querySelector("#user-admin-list");
  if (!target) return;
  if (adminMode !== "supabase") {
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
    target.innerHTML = `<p class="usage-admin-loading is-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data?.length) {
    target.innerHTML = '<div class="scan-empty"><span>조건에 맞는 사용자가 없습니다.</span></div>';
    return;
  }
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

  target.querySelectorAll(".user-admin-item").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector(".user-admin-message");
    const button = form.querySelector("button");
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
  const trayMode = form.querySelector(`input[name="tray_display_mode"][value="${operationalSettings.trayDisplayMode}"]`);
  if (trayMode) trayMode.checked = true;
  form.querySelector("button[type=submit]").disabled = adminMode !== "supabase";
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
});

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
    const { error: trayModeError } = await client.rpc("admin_update_tray_display_mode", {
      target_mode: values.get("tray_display_mode"),
    });
    if (trayModeError) throw trayModeError;
    await loadOperationalSettings();
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
    if (error) throw new Error(data?.error || error.message);
    await loadDatabaseMeals();
    renderStats();
    renderMeals();
    target.innerHTML = `<p><strong>${escapeHtml(data.period.from)} ~ ${escapeHtml(data.period.to)} 최신화 완료</strong></p><div class="import-status__meta"><span>신규 ${data.insertedCount}건</span><span>변경 ${data.updatedCount}건</span><span>동일 ${data.unchangedCount}건</span><span>수동 보호 ${data.protectedCount}건</span></div>`;
  } catch (error) {
    target.classList.add("is-error");
    target.innerHTML = `<p><strong>최신화 실패</strong> · ${escapeHtml(error.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "지금 가져오기";
  }
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
  const { data } = await client.from("meals").select("id, meal_date, meal_type, is_published, is_operating, admin_note, meal_tray_images(id, storage_path, image_url, alt_text), meal_items(display_order, original_menu_text)").order("meal_date", { ascending: false });
  meals = (data ?? []).map(mapDatabaseMeal);
};

document.querySelector("#admin-menu-button").addEventListener("click", () => {
  const sidebar = document.querySelector(".admin-sidebar");
  const open = !sidebar.classList.contains("is-open");
  sidebar.classList.toggle("is-open", open);
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", String(open));
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
  const menuItems = String(data.get("menu_items")).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!menuItems.length) return;
  button.disabled = true;
  message.textContent = "저장 중…";
  try {
    await saveMeal({
      mealDate: data.get("meal_date"), mealType: data.get("meal_type"), menuItems,
      adminNote: null, isOperating: true, isPublished: true,
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
const accessAllowed = await initializeAdmin();
if (accessAllowed !== false) {
  setScanDefaults();
  route(location.hash.slice(1));
  renderStats();
  renderMeals();
  await renderImportStatus();
}
