import { getAuthState, loadMyPageData, signInWithKakao, signOut } from "./auth.js";

const demoData = {
  profile: {
    name: "밥풀 학생",
    affiliation: "IT융합자율학부",
    profile_image_url: null,
    auth_provider: "kakao",
    qr_token: "00000000-0000-4000-8000-000000000001",
  },
  usages: [
    { id: 1, meal_date: "2026-10-20", meal_type: "lunch", price: 5300, status: "active" },
    { id: 2, meal_date: "2026-10-16", meal_type: "breakfast", price: 1000, status: "active" },
    { id: 3, meal_date: "2026-10-14", meal_type: "lunch", price: 5300, status: "active" },
    { id: 4, meal_date: "2026-10-09", meal_type: "breakfast", price: 1000, status: "active" },
    { id: 5, meal_date: "2026-10-07", meal_type: "lunch", price: 5300, status: "active" },
  ],
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const loginTemplate = (available) => `<div class="login-card">
  <img class="login-card__logo" src="asset/밥풀매니아_로고.png" alt="" />
  <h2>내 식권을 확인하세요</h2>
  <p>카카오 계정으로 로그인하면 개인 QR 식권과 이번 달 이용 내역을 확인할 수 있어요.</p>
  <button class="kakao-button" id="kakao-login" type="button" ${available ? "" : "disabled"}>카카오로 시작하기</button>
  ${available ? "" : '<button class="demo-button" id="demo-mypage" type="button">시연 화면 미리보기</button><p class="login-card__setup">현재는 Supabase 설정 전입니다. 시연 화면은 실제 로그인이나 식권이 아닙니다.</p>'}
</div>`;

const usageLabel = (type) => type === "breakfast" ? "조식" : "중식";

const dashboardTemplate = ({ profile, usages }, isDemo) => {
  const activeUsages = usages.filter((usage) => usage.status === "active");
  const total = activeUsages.reduce((sum, usage) => sum + usage.price, 0);
  const initial = escapeHtml(profile.name?.trim()?.[0] || "밥");
  const avatar = profile.profile_image_url
    ? `<img src="${escapeHtml(profile.profile_image_url)}" alt="" referrerpolicy="no-referrer" />`
    : initial;
  const usageItems = activeUsages.slice(0, 6).map((usage) => `<li>
    <div class="usage-list__meta"><strong>${escapeHtml(usage.meal_date)} · ${usageLabel(usage.meal_type)}</strong><span>정상 처리</span></div>
    <span class="usage-list__price">${usage.price.toLocaleString("ko-KR")}원</span>
  </li>`).join("");
  return `${isDemo ? '<div class="demo-banner"><span>시연용 데이터입니다. 실제 계정·식권과 연결되지 않습니다.</span><button id="exit-demo" type="button">나가기</button></div>' : ""}
    <section class="profile-summary">
      <div class="profile-avatar">${avatar}</div>
      <div class="profile-summary__info"><strong>${escapeHtml(profile.name || "이름 미등록")}</strong><span>${escapeHtml(profile.affiliation || "소속 미등록")}</span></div>
      <span class="connected-badge">카카오 연동</span>
    </section>
    <div class="mypage-grid">
      <section class="ticket-card">
        <h2>개인 QR 식권</h2>
        <p class="card-description">관리자에게 이 화면의 QR을 보여주세요.</p>
        <div class="qr-frame" id="qr-code"><div class="qr-fallback">QR을 만들고 있어요.</div></div>
        <p class="qr-warning">QR은 캡쳐하여 사용해도 무방합니다.<br />단, 본인 이외의 사용은 금지합니다.</p>
      </section>
      <section class="usage-card">
        <h2>이번 달 이용</h2>
        <p class="card-description">현재 유효한 이용 기록 기준입니다.</p>
        <div class="usage-stats">
          <div class="usage-stat"><span>이용 횟수</span><strong>${activeUsages.length}회</strong></div>
          <div class="usage-stat"><span>이용 금액</span><strong>${total.toLocaleString("ko-KR")}원</strong></div>
        </div>
        <ul class="usage-list">${usageItems || "<li>이번 달 이용 내역이 없습니다.</li>"}</ul>
      </section>
    </div>
    ${isDemo ? "" : '<button class="logout-button" id="logout" type="button">로그아웃</button>'}`;
};

const renderQr = async (token) => {
  const target = document.querySelector("#qr-code");
  try {
    const QRCode = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, token, { width: 260, margin: 1, errorCorrectionLevel: "M", color: { dark: "#18181b", light: "#ffffff" } });
    target.replaceChildren(canvas);
  } catch {
    target.innerHTML = '<div class="qr-fallback">QR 라이브러리를 불러오지 못했습니다.<br />네트워크 연결을 확인해 주세요.</div>';
  }
};

const renderDashboard = (data, isDemo = false) => {
  document.querySelector("#mypage-content").innerHTML = dashboardTemplate(data, isDemo);
  renderQr(data.profile.qr_token);
  document.querySelector("#exit-demo")?.addEventListener("click", () => renderLogin(false));
  document.querySelector("#logout")?.addEventListener("click", async () => {
    await signOut();
    await renderMyPage();
  });
};

const renderLogin = (available) => {
  document.querySelector("#mypage-content").innerHTML = loginTemplate(available);
  document.querySelector("#kakao-login")?.addEventListener("click", async () => {
    const button = document.querySelector("#kakao-login");
    button.disabled = true;
    button.textContent = "카카오로 이동 중…";
    try { await signInWithKakao(); }
    catch (error) {
      button.disabled = false;
      button.textContent = "다시 시도하기";
      window.alert(error.message || "로그인을 시작하지 못했습니다.");
    }
  });
  document.querySelector("#demo-mypage")?.addEventListener("click", () => renderDashboard(demoData, true));
};

export const renderMyPage = async () => {
  const auth = await getAuthState();
  if (!auth.available || !auth.session) {
    renderLogin(auth.available);
    return false;
  }
  try {
    const data = await loadMyPageData(auth.session.user.id);
    renderDashboard(data, false);
  } catch {
    document.querySelector("#mypage-content").innerHTML = '<div class="empty-state"><h2>내 정보를 불러오지 못했어요</h2><p>잠시 후 다시 시도하거나 관리자에게 문의해 주세요.</p></div>';
  }
  return true;
};
