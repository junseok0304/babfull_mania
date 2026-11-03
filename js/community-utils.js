export const normalizeCommunityText = (value) => String(value ?? "").trim().replace(/\s+/gu, " ");

export const validateSuggestion = ({ title, body, authorName }) => {
  const normalized = {
    title: normalizeCommunityText(title),
    body: String(body ?? "").trim(),
    authorName: normalizeCommunityText(authorName),
  };
  if (!normalized.authorName) throw new Error("실명 프로필을 확인할 수 없습니다.");
  if (normalized.title.length < 2 || normalized.title.length > 100) throw new Error("제목은 2자 이상 100자 이하로 입력해주세요.");
  if (normalized.body.length < 5 || normalized.body.length > 3000) throw new Error("내용은 5자 이상 3000자 이하로 입력해주세요.");
  return normalized;
};

export const canViewSuggestion = (suggestion, isAdmin = false) => !suggestion?.isPrivate || isAdmin;

export const selectFeaturedNotice = (notices = []) => notices.find((notice) => notice.isFeatured) || notices[0] || null;

export const clampLikeCount = (value) => Math.max(0, Number(value) || 0);
