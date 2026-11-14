import { signInWithKakao } from "./auth.js";
import { createCommunitySuggestion, loadCommunity, toggleCommunityNoticeLike } from "./community-service.js";

/** 공지 배너·목록과 사용자 건의 폼을 렌더링하는 화면 모듈입니다. 모든 사용자 문자열은 출력 전에 이스케이프합니다. */
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatDate = (value) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric",
}).format(new Date(value));

const renderBanner = (notice) => {
  const banner = document.querySelector("#home-announcement-banner");
  if (!banner) return;
  if (!notice) {
    banner.innerHTML = '<span class="announcement-banner__eyebrow">밥풀매니아</span><strong>오늘의 식단을 확인하세요</strong><span>공지와 이벤트 소식도 이곳에서 전해드려요.</span>';
    return;
  }
  banner.classList.toggle("has-image", Boolean(notice.imageUrl));
  banner.style.setProperty("--announcement-image", notice.imageUrl ? `url("${String(notice.imageUrl).replaceAll('"', '%22')}")` : "none");
  banner.innerHTML = `<span class="announcement-banner__eyebrow">공지 · 이벤트</span><strong>${escapeHtml(notice.title)}</strong><span>${escapeHtml(notice.body)}</span>`;
};

const noticeCard = (notice) => `<article class="community-notice-card" data-notice-id="${notice.id}">
  ${notice.imageUrl ? `<img src="${escapeHtml(notice.imageUrl)}" alt="" loading="lazy" />` : '<div class="community-notice-card__placeholder" aria-hidden="true">밥full</div>'}
  <div class="community-notice-card__body">
    <div class="community-notice-card__meta"><span>${notice.isFeatured ? "주요 공지" : "공지사항"}</span><time datetime="${escapeHtml(notice.publishedAt)}">${escapeHtml(formatDate(notice.publishedAt))}</time></div>
    <h2>${escapeHtml(notice.title)}</h2>
    <p>${escapeHtml(notice.body)}</p>
    <button class="notice-like${notice.liked ? " is-liked" : ""}" type="button" data-notice-like="${notice.id}" aria-pressed="${notice.liked}"><span aria-hidden="true">♥</span> 좋아요 <b>${notice.likeCount}</b></button>
  </div>
</article>`;

const suggestionCard = (suggestion) => `<article class="suggestion-card">
  <div class="suggestion-card__meta"><strong>${escapeHtml(suggestion.authorName)}</strong><time datetime="${escapeHtml(suggestion.createdAt)}">${escapeHtml(formatDate(suggestion.createdAt))}</time></div>
  <h3>${escapeHtml(suggestion.title)}</h3>
  <p>${escapeHtml(suggestion.body)}</p>
</article>`;

const renderCommunity = (state) => {
  renderBanner(state.featuredNotice);
  const noticeTarget = document.querySelector("#community-notice-list");
  noticeTarget.innerHTML = state.notices.length ? state.notices.map(noticeCard).join("") : '<div class="community-empty">등록된 공지사항이 없습니다.</div>';
  const suggestionTarget = document.querySelector("#community-suggestion-list");
  suggestionTarget.innerHTML = state.suggestions.length ? state.suggestions.map(suggestionCard).join("") : '<div class="community-empty">첫 번째 공개 건의를 남겨주세요.</div>';

  const identity = document.querySelector("#suggestion-identity");
  const submit = document.querySelector("#suggestion-form button[type=submit]");
  if (state.profile?.isActive) {
    identity.innerHTML = `<span>${escapeHtml(state.profile.name?.[0] || "밥")}</span><div><strong>${escapeHtml(state.profile.name)}</strong><small>실명으로 작성됩니다 · ${escapeHtml(state.profile.affiliation || "소속 미등록")}</small></div>`;
    submit.textContent = "건의사항 등록";
  } else {
    identity.innerHTML = '<span>?</span><div><strong>로그인이 필요합니다</strong><small>건의사항은 카카오 로그인 프로필의 실명으로 작성됩니다.</small></div>';
    submit.textContent = "로그인하고 건의하기";
  }
};

const setActivePanel = (panelName) => {
  document.querySelectorAll("[data-community-panel]").forEach((panel) => { panel.hidden = panel.dataset.communityPanel !== panelName; });
  document.querySelectorAll("[data-community-tab]").forEach((button) => {
    const active = button.dataset.communityTab === panelName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
};

export const initCommunity = async () => {
  let state;
  try {
    state = await loadCommunity();
    renderCommunity(state);
  } catch (error) {
    document.querySelector("#community-notice-list").innerHTML = `<div class="community-empty">공지사항을 불러오지 못했습니다.<br />${escapeHtml(error.message)}</div>`;
    return;
  }

  document.querySelectorAll("[data-community-tab]").forEach((button) => button.addEventListener("click", () => setActivePanel(button.dataset.communityTab)));

  document.querySelector("#community-notice-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-notice-like]");
    if (!button) return;
    button.disabled = true;
    try {
      const updated = await toggleCommunityNoticeLike(Number(button.dataset.noticeLike));
      const notice = state.notices.find((item) => item.id === updated.id);
      if (notice) Object.assign(notice, updated);
      renderCommunity(state);
    } catch (error) {
      if (error.message === "LOGIN_REQUIRED") {
        await signInWithKakao({ returnRoute: "community" });
        return;
      }
      button.disabled = false;
    }
  });

  document.querySelector("#suggestion-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.querySelector("#suggestion-message");
    if (!state.profile?.isActive) {
      try { await signInWithKakao({ returnRoute: "community" }); } catch (error) { message.textContent = error.message; }
      return;
    }
    const data = new FormData(form);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    message.textContent = "건의사항을 등록하고 있어요…";
    try {
      const created = await createCommunitySuggestion({
        title: data.get("title"), body: data.get("body"), isPrivate: data.get("is_private") === "on",
      });
      form.reset();
      if (!created.isPrivate) {
        state.suggestions.unshift(created);
        renderCommunity(state);
      }
      window.dispatchEvent(new CustomEvent("babfull:suggestions-changed", { detail: { action: "created", suggestion: created } }));
      message.textContent = created.isPrivate
        ? "비밀 건의가 운영진에게 전달되었습니다. 운영진만 내용을 확인할 수 있어요."
        : "건의사항을 공개로 등록했습니다.";
    } catch (error) {
      if (error.message === "LOGIN_REQUIRED") await signInWithKakao({ returnRoute: "community" });
      else message.textContent = error.message || "건의사항을 등록하지 못했습니다.";
    } finally {
      button.disabled = false;
    }
  });

  window.addEventListener("babfull:suggestions-changed", (event) => {
    if (event.detail?.action !== "deleted") return;
    state.suggestions = state.suggestions.filter((suggestion) => suggestion.id !== event.detail.suggestionId);
    renderCommunity(state);
  });

  window.addEventListener("babfull:auth-changed", async (event) => {
    if (event.detail?.event !== "SIGNED_OUT") return;

    // 네트워크 재조회보다 먼저 개인 프로필과 좋아요 여부를 지워 로그아웃 직후
    // 이전 사용자 정보가 잠시라도 공지·건의 화면에 남지 않도록 한다.
    state = {
      ...state,
      session: null,
      profile: null,
      notices: state.notices.map((notice) => ({ ...notice, liked: false })),
    };
    document.querySelector("#suggestion-form")?.reset();
    document.querySelector("#suggestion-message").textContent = "";
    renderCommunity(state);

    try {
      state = await loadCommunity();
      renderCommunity(state);
    } catch {
      // 익명 상태 전환은 이미 완료됐으므로 공개 데이터 재조회 실패 시에도
      // 로그아웃한 사용자의 프로필을 복원하지 않는다.
    }
  });

  setActivePanel("notices");
};
