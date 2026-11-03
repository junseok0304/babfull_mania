import {
  createCommunityNotice,
  deleteCommunityNotice,
  deleteCommunitySuggestion,
  loadCommunity,
} from "./community-service.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const formatDateTime = (value) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short",
}).format(new Date(value));

let context = { client: null, mode: "demo", currentUserId: null };
let notices = [];
let suggestions = [];

const renderNotices = () => {
  const target = document.querySelector("#admin-notice-list");
  target.innerHTML = notices.length ? notices.map((notice) => `<article class="admin-community-item">
    ${notice.imageUrl ? `<img src="${escapeHtml(notice.imageUrl)}" alt="" />` : '<div class="admin-community-item__image">공지</div>'}
    <div><span>${notice.isFeatured ? "대표 배너" : "일반 공지"} · 좋아요 ${notice.likeCount}개</span><strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.body)}</p><small>${escapeHtml(formatDateTime(notice.publishedAt))}</small></div>
    <button class="secondary-button" type="button" data-delete-notice="${notice.id}">삭제</button>
  </article>`).join("") : '<div class="admin-community-empty">등록한 공지사항이 없습니다.</div>';
};

const renderSuggestions = () => {
  const target = document.querySelector("#admin-suggestion-list");
  target.innerHTML = suggestions.length ? suggestions.map((suggestion) => `<article class="admin-suggestion-item${suggestion.isPrivate ? " is-private" : ""}">
    <div class="admin-suggestion-item__top"><span>${suggestion.isPrivate ? "운영진 전용" : "공개 건의"}</span><time>${escapeHtml(formatDateTime(suggestion.createdAt))}</time></div>
    <h3>${escapeHtml(suggestion.title)}</h3><p>${escapeHtml(suggestion.body)}</p>
    <footer><strong>${escapeHtml(suggestion.authorName)}</strong><button class="secondary-button" type="button" data-delete-suggestion="${suggestion.id}">삭제</button></footer>
  </article>`).join("") : '<div class="admin-community-empty">접수된 건의사항이 없습니다.</div>';
};

const refresh = async () => {
  const state = await loadCommunity({ includePrivate: true });
  notices = state.notices;
  suggestions = state.suggestions;
  renderNotices();
  renderSuggestions();
};

export const initAdminCommunity = async (options) => {
  context = options;
  const form = document.querySelector("#notice-form");
  const preview = document.querySelector("#notice-image-preview");
  const fileInput = form.elements.image;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      preview.innerHTML = "<span>사진을 선택하면 배너 미리보기가 표시됩니다.</span>";
      return;
    }
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${escapeHtml(url)}" alt="공지 배너 미리보기" />`;
    preview.querySelector("img").addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const button = form.querySelector("button[type=submit]");
    const message = document.querySelector("#notice-form-message");
    const imageFile = fileInput.files?.[0] || null;
    if (imageFile && imageFile.size > 10 * 1024 * 1024) {
      message.textContent = "이미지는 10MB 이하로 선택해주세요.";
      return;
    }
    button.disabled = true;
    message.textContent = "공지사항을 저장하고 있어요…";
    try {
      await createCommunityNotice({
        ...context,
        userId: context.currentUserId,
        title: values.get("title"), body: values.get("body"), isFeatured: values.get("is_featured") === "on", imageFile,
      });
      form.reset();
      preview.innerHTML = "<span>사진을 선택하면 배너 미리보기가 표시됩니다.</span>";
      await refresh();
      message.textContent = "공지사항을 등록했습니다.";
    } catch (error) {
      message.textContent = error.message || "공지사항을 저장하지 못했습니다.";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#admin-notice-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-notice]");
    if (!button) return;
    const notice = notices.find((item) => item.id === Number(button.dataset.deleteNotice));
    if (!notice) return;
    button.disabled = true;
    await deleteCommunityNotice({ ...context, notice });
    await refresh();
  });

  document.querySelector("#admin-suggestion-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-suggestion]");
    if (!button) return;
    button.disabled = true;
    await deleteCommunitySuggestion({ ...context, suggestionId: Number(button.dataset.deleteSuggestion) });
    await refresh();
  });

  await refresh();
};
