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
  const menuSelect = document.querySelector("#food-image-menu");
  const selectedMenu = menuSelect.value;
  const menuNames = [...new Set(sortedMeals().flatMap((meal) => meal.items))]
    .filter((name) => name && !/운영시간|메뉴가 없습니다|휴무/u.test(name))
    .sort((a, b) => a.localeCompare(b, "ko"));
  menuSelect.innerHTML = `<option value="">메뉴를 선택하세요</option>${menuNames
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (menuNames.includes(selectedMenu)) menuSelect.value = selectedMenu;
};

const imageMarkup = (image, className = "") => `<img class="${className}" src="${escapeHtml(image.imageUrl || image.fallbackUrl)}"
  data-fallback-src="${escapeHtml(image.fallbackUrl || "")}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;

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
  foodImageCandidates = data.candidates ?? [];
  const current = data.current
    ? `<figure class="food-image-current">${imageMarkup(data.current)}<figcaption><span>현재 대표 사진</span><strong>${escapeHtml(data.current.sourceName || "출처 정보 없음")}</strong></figcaption></figure>`
    : '<div class="food-image-current is-empty"><strong>저장된 대표 사진이 없습니다.</strong></div>';
  const candidates = foodImageCandidates.length
    ? `<div class="food-image-candidates">${foodImageCandidates.map((candidate, index) => `<article class="food-image-candidate">
        <div class="food-image-candidate__preview">${imageMarkup(candidate)}</div>
        <div class="food-image-candidate__meta"><span>${escapeHtml(candidate.sourceName || "이미지 검색")}</span><small>${candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : "크기 정보 없음"}</small></div>
        <button class="secondary-button" type="button" data-image-candidate="${index}">이 사진 사용</button>
      </article>`).join("")}</div>`
    : '<div class="food-image-empty"><strong>다른 사진 후보를 찾지 못했습니다.</strong><span>잠시 후 다시 검색해주세요.</span></div>';
  document.querySelector("#food-image-workspace").innerHTML = `<div class="food-image-current-panel"><h3>${escapeHtml(data.food.name)}</h3>${current}</div><div class="food-image-results"><h3>대체 사진 후보</h3>${candidates}</div>`;
  bindManagedImageFallbacks();
};

const loadFoodImageCandidates = async (foodName) => {
  if (adminMode !== "supabase") throw new Error("운영 데이터 연결 후 사용할 수 있습니다.");
  const { data, error } = await client.functions.invoke("manage-food-image", {
    body: { action: "candidates", foodName },
  });
  if (error) throw new Error(data?.error || error.message);
  renderFoodImageWorkspace(data);
};

const mapDatabaseMeal = (record) => ({
  id: record.id,
  date: record.meal_date,
  type: record.meal_type,
  published: record.is_published,
  items: [...(record.meal_items ?? [])].sort((a, b) => a.display_order - b.display_order).map((item) => item.original_menu_text),
});

const loadDatabaseMeals = async () => {
  const { data, error } = await client.from("meals")
    .select("id, meal_date, meal_type, is_published, meal_items(display_order, original_menu_text)")
    .order("meal_date", { ascending: false }).limit(80);
  if (error) throw error;
  meals = (data ?? []).map(mapDatabaseMeal);
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
      <div class="user-admin-person"><div class="scanned-profile__avatar">${escapeHtml(profile.name?.[0] || "밥")}</div><div><strong>${escapeHtml(profile.name || "이름 미등록")}</strong><span>${escapeHtml(profile.affiliation || "소속 미등록")} · ${userTypeLabel(profile.user_type)}</span></div></div>
      <label>소속<input name="affiliation" value="${escapeHtml(profile.affiliation || "")}" placeholder="소속 미등록" /></label>
      <label>사용자 유형<select name="user_type"><option value="student"${profile.user_type === "student" ? " selected" : ""}>학생</option><option value="faculty"${profile.user_type === "faculty" ? " selected" : ""}>교원</option><option value="staff"${profile.user_type === "staff" ? " selected" : ""}>직원</option><option value="other"${profile.user_type === "other" ? " selected" : ""}>기타</option></select></label>
      <label>권한<select name="role"${isSelf ? " disabled" : ""}><option value="user"${profile.role === "user" ? " selected" : ""}>일반 사용자</option><option value="admin"${profile.role === "admin" ? " selected" : ""}>관리자</option></select>${isSelf ? '<input type="hidden" name="role" value="admin" />' : ""}</label>
      <label class="user-active"><input name="is_active" type="checkbox"${profile.is_active ? " checked" : ""}${isSelf ? " disabled" : ""} /><span>${profile.is_active ? "활성" : "비활성"}</span>${isSelf ? '<input type="hidden" name="self_active" value="true" />' : ""}</label>
      <button class="secondary-button" type="submit">저장</button>
      <p class="user-admin-message" role="status">${isSelf ? "현재 로그인한 관리자 계정" : ""}</p>
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
      adminNote: null, isOperating: data.get("is_operating") === "on", isPublished: data.get("is_published") === "on",
    });
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
  button.disabled = true;
  message.textContent = "대체 사진을 찾고 있습니다…";
  try {
    await loadFoodImageCandidates(foodName);
    message.textContent = `${foodName} 사진 후보를 불러왔습니다.`;
  } catch (error) {
    message.textContent = error.message || "사진 후보를 불러오지 못했습니다.";
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#food-image-workspace").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-image-candidate]");
  if (!button) return;
  const candidate = foodImageCandidates[Number(button.dataset.imageCandidate)];
  const foodName = document.querySelector("#food-image-menu").value;
  const message = document.querySelector("#food-image-message");
  if (!candidate || !foodName) return;
  button.disabled = true;
  message.textContent = "대표 사진으로 저장하고 있습니다…";
  try {
    const { data, error } = await client.functions.invoke("manage-food-image", {
      body: { action: "select", foodName, imageUrl: candidate.imageUrl },
    });
    if (error) throw new Error(data?.error || error.message);
    await loadFoodImageCandidates(foodName);
    message.textContent = `${foodName} 대표 사진을 변경했습니다. 사용자 식판에서 계속 재사용됩니다.`;
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
