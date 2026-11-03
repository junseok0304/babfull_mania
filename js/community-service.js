import { getSupabaseClient } from "./supabase-client.js";
import { clampLikeCount, isOwnedSuggestion, selectFeaturedNotice, validateSuggestion } from "./community-utils.js";

const NOTICE_KEY = "babfull:demo-notices";
const SUGGESTION_KEY = "babfull:demo-suggestions";
const LIKE_KEY = "babfull:demo-notice-likes";
const demoProfile = { id: "demo-user", name: "윤준석", affiliation: "성공회대학교 재학생", isActive: true };
const demoBannerUrl = new URL("../asset/generated-meal-trays/2026-11-02/2026-11-02-lunch-v1.png", import.meta.url).href;

const demoNotices = [
  {
    id: 1,
    authorId: "demo-other-user",
    title: "11월 식단과 밥풀매니아 새 기능을 확인해보세요",
    body: "이번 주 식단 이미지와 예상 열량을 업데이트했습니다. 공지사항에 좋아요를 누르고 식당 운영에 대한 건의도 남겨주세요.",
    imageUrl: demoBannerUrl,
    imageStoragePath: null,
    isFeatured: true,
    likeCount: 12,
    liked: false,
    publishedAt: "2026-11-03T09:00:00+09:00",
  },
  {
    id: 2,
    authorId: "demo-user",
    title: "건의사항 게시판 시범 운영 안내",
    body: "공개 건의는 모든 이용자가 볼 수 있고, 비밀글은 운영진만 열람합니다. 모든 건의는 로그인 프로필의 실명으로 접수됩니다.",
    imageUrl: null,
    imageStoragePath: null,
    isFeatured: false,
    likeCount: 4,
    liked: false,
    publishedAt: "2026-11-02T15:00:00+09:00",
  },
];

const demoSuggestions = [
  {
    id: 1,
    authorName: "김밥풀",
    title: "샐러드 메뉴가 더 자주 나오면 좋겠습니다",
    body: "채소를 고를 수 있는 날이 조금 더 많아지면 좋겠습니다.",
    isPrivate: false,
    createdAt: "2026-11-03T10:20:00+09:00",
  },
  {
    id: 2,
    authorName: "윤준석",
    title: "운영진 확인용 비밀 건의",
    body: "이 내용은 관리자 화면에서만 확인할 수 있습니다.",
    isPrivate: true,
    createdAt: "2026-11-03T11:00:00+09:00",
  },
];

const parseStored = (key, fallback) => {
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    return Array.isArray(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};

const saveStored = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export const isCommunityDemo = () => ["localhost", "127.0.0.1"].includes(window.location.hostname)
  || new URLSearchParams(window.location.search).get("demo") === "1";

const loadDemoState = (includePrivate = false) => {
  const likedIds = new Set(parseStored(LIKE_KEY, []));
  const notices = parseStored(NOTICE_KEY, demoNotices).map((notice) => ({ ...notice, liked: likedIds.has(notice.id) }));
  const suggestions = parseStored(SUGGESTION_KEY, demoSuggestions).filter((suggestion) => includePrivate || !suggestion.isPrivate);
  return { notices, suggestions, profile: demoProfile, featuredNotice: selectFeaturedNotice(notices) };
};

const mapNotice = (record, likedIds = new Set()) => ({
  id: record.id,
  title: record.title,
  body: record.body,
  imageUrl: record.image_url,
  imageStoragePath: record.image_storage_path,
  isFeatured: record.is_featured,
  likeCount: clampLikeCount(record.like_count),
  liked: likedIds.has(record.id),
  publishedAt: record.published_at,
});

const mapSuggestion = (record) => ({
  id: record.id,
  authorId: record.author_id,
  authorName: record.author_name,
  title: record.title,
  body: record.body,
  isPrivate: record.is_private,
  createdAt: record.created_at,
});

const loadSessionProfile = async (client) => {
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { session: null, profile: null };
  const { data: profile } = await client.from("profiles").select("id, name, affiliation, is_active").eq("id", userId).maybeSingle();
  return {
    session: sessionData.session,
    profile: profile ? { id: profile.id, name: profile.name, affiliation: profile.affiliation, isActive: profile.is_active } : null,
  };
};

export const loadCommunity = async ({ includePrivate = false } = {}) => {
  if (isCommunityDemo()) return { mode: "demo", ...loadDemoState(includePrivate) };
  const client = await getSupabaseClient();
  if (!client) return { mode: "demo", ...loadDemoState(includePrivate) };
  const { session, profile } = await loadSessionProfile(client);
  const [noticeResult, suggestionResult, likeResult] = await Promise.all([
    client.from("notices").select("id, title, body, image_url, image_storage_path, is_featured, like_count, published_at").order("published_at", { ascending: false }),
    client.from("suggestions").select("id, author_id, author_name, title, body, is_private, created_at").order("created_at", { ascending: false }),
    session ? client.from("notice_likes").select("notice_id").eq("user_id", session.user.id) : Promise.resolve({ data: [] }),
  ]);
  if (noticeResult.error) throw noticeResult.error;
  if (suggestionResult.error) throw suggestionResult.error;
  const likedIds = new Set((likeResult.data ?? []).map((row) => row.notice_id));
  const notices = (noticeResult.data ?? []).map((record) => mapNotice(record, likedIds));
  return {
    mode: "supabase",
    client,
    session,
    profile,
    notices,
    suggestions: (suggestionResult.data ?? []).map(mapSuggestion),
    featuredNotice: selectFeaturedNotice(notices),
  };
};

export const toggleCommunityNoticeLike = async (noticeId) => {
  if (isCommunityDemo()) {
    const state = loadDemoState(true);
    const likedIds = new Set(parseStored(LIKE_KEY, []));
    const wasLiked = likedIds.has(noticeId);
    if (wasLiked) likedIds.delete(noticeId); else likedIds.add(noticeId);
    saveStored(LIKE_KEY, [...likedIds]);
    const notices = state.notices.map((notice) => notice.id === noticeId
      ? { ...notice, liked: !wasLiked, likeCount: clampLikeCount(notice.likeCount + (wasLiked ? -1 : 1)) }
      : notice);
    saveStored(NOTICE_KEY, notices.map(({ liked, ...notice }) => notice));
    return notices.find((notice) => notice.id === noticeId);
  }
  const client = await getSupabaseClient();
  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) throw new Error("LOGIN_REQUIRED");
  const { data, error } = await client.rpc("toggle_notice_like", { target_notice_id: noticeId }).single();
  if (error) throw error;
  return { id: noticeId, liked: data.liked, likeCount: data.new_like_count };
};

export const createCommunitySuggestion = async ({ title, body, isPrivate }) => {
  if (isCommunityDemo()) {
    const normalized = validateSuggestion({ title, body, authorName: demoProfile.name });
    const suggestions = parseStored(SUGGESTION_KEY, demoSuggestions);
    const created = {
      id: Date.now(), authorId: demoProfile.id, authorName: normalized.authorName, title: normalized.title, body: normalized.body,
      isPrivate: Boolean(isPrivate), createdAt: new Date().toISOString(),
    };
    saveStored(SUGGESTION_KEY, [created, ...suggestions]);
    return created;
  }
  const client = await getSupabaseClient();
  const { session, profile } = await loadSessionProfile(client);
  if (!session) throw new Error("LOGIN_REQUIRED");
  const normalized = validateSuggestion({ title, body, authorName: profile?.name });
  const { data, error } = await client.rpc("create_suggestion", {
    suggestion_title: normalized.title,
    suggestion_body: normalized.body,
    private_post: Boolean(isPrivate),
  });
  if (error) throw error;
  return { id: data, authorId: session.user.id, authorName: normalized.authorName, title: normalized.title, body: normalized.body, isPrivate: Boolean(isPrivate), createdAt: new Date().toISOString() };
};

export const loadOwnCommunitySuggestions = async ({ forceRemote = false } = {}) => {
  if (!forceRemote && isCommunityDemo()) {
    return loadDemoState(true).suggestions.filter((suggestion) => (
      isOwnedSuggestion(suggestion, demoProfile.id)
      || (!suggestion.authorId && suggestion.authorName === demoProfile.name)
    ));
  }
  const client = await getSupabaseClient();
  if (!client) return [];
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error("LOGIN_REQUIRED");
  const { data, error } = await client.from("suggestions")
    .select("id, author_id, author_name, title, body, is_private, created_at")
    .eq("author_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSuggestion);
};

export const deleteOwnCommunitySuggestion = async (suggestionId, { forceRemote = false } = {}) => {
  if (!forceRemote && isCommunityDemo()) {
    saveStored(SUGGESTION_KEY, parseStored(SUGGESTION_KEY, demoSuggestions).filter((item) => item.id !== suggestionId));
    return;
  }
  const client = await getSupabaseClient();
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error("LOGIN_REQUIRED");
  const { error } = await client.from("suggestions").delete().eq("id", suggestionId).eq("author_id", userId);
  if (error) throw error;
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
  reader.readAsDataURL(file);
});

const prepareDemoImage = async (file) => {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 등록할 수 있습니다.");
  if (typeof createImageBitmap !== "function") return fileToDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width, 900 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.84);
};

export const createCommunityNotice = async ({ client, mode, userId, title, body, isFeatured, imageFile }) => {
  if (mode === "demo") {
    const notices = parseStored(NOTICE_KEY, demoNotices);
    const imageUrl = await prepareDemoImage(imageFile);
    const created = {
      id: Date.now(), title: String(title).trim(), body: String(body).trim(), imageUrl, imageStoragePath: null,
      isFeatured: Boolean(isFeatured), likeCount: 0, publishedAt: new Date().toISOString(),
    };
    const next = [created, ...notices].map((notice) => ({ ...notice, isFeatured: created.isFeatured ? notice.id === created.id : notice.isFeatured }));
    saveStored(NOTICE_KEY, next);
    return created;
  }

  let storagePath = null;
  let imageUrl = null;
  if (imageFile) {
    const extension = imageFile.name.split(".").pop()?.toLowerCase() || "jpg";
    storagePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await client.storage.from("notice-images").upload(storagePath, imageFile, { contentType: imageFile.type, cacheControl: "31536000" });
    if (uploadError) throw uploadError;
    imageUrl = client.storage.from("notice-images").getPublicUrl(storagePath).data.publicUrl;
  }
  if (isFeatured) await client.from("notices").update({ is_featured: false }).eq("is_featured", true);
  const { data, error } = await client.from("notices").insert({
    title: String(title).trim(), body: String(body).trim(), image_url: imageUrl, image_storage_path: storagePath,
    is_featured: Boolean(isFeatured), created_by: userId,
  }).select().single();
  if (error) {
    if (storagePath) await client.storage.from("notice-images").remove([storagePath]);
    throw error;
  }
  return mapNotice(data);
};

export const deleteCommunityNotice = async ({ client, mode, notice }) => {
  if (mode === "demo") {
    saveStored(NOTICE_KEY, parseStored(NOTICE_KEY, demoNotices).filter((item) => item.id !== notice.id));
    return;
  }
  const { error } = await client.from("notices").delete().eq("id", notice.id);
  if (error) throw error;
  if (notice.imageStoragePath) await client.storage.from("notice-images").remove([notice.imageStoragePath]);
};

export const deleteCommunitySuggestion = async ({ client, mode, suggestionId }) => {
  if (mode === "demo") {
    saveStored(SUGGESTION_KEY, parseStored(SUGGESTION_KEY, demoSuggestions).filter((item) => item.id !== suggestionId));
    return;
  }
  const { error } = await client.from("suggestions").delete().eq("id", suggestionId);
  if (error) throw error;
};
