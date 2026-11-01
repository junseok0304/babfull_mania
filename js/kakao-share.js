import { buildKakaoTemplateArgs } from "./kakao-message.js?v=20261101-1";
import { getAuthState } from "./auth.js?v=20261101-1";

// JavaScript 키는 브라우저에 공개되는 플랫폼 키이며 등록 도메인에서만 사용할 수 있다.
const KAKAO_JAVASCRIPT_KEY = "38a2a6d37a352a1a567f10ee8d1a0cec";
const TEMPLATE_ID = 138483;

const getKakaoSdk = () => {
  const kakao = window.Kakao;
  if (!kakao?.Share?.sendCustom) {
    throw new Error("카카오톡 공유 기능을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
  }
  if (!kakao.isInitialized()) kakao.init(KAKAO_JAVASCRIPT_KEY);
  return kakao;
};

const recordAuthenticatedPickerOpen = async (meal) => {
  try {
    const { session, client } = await getAuthState();
    if (!session?.user || !client) return;
    const { error } = await client.rpc("record_kakao_share", {
      target_meal_date: meal.date,
      target_meal_type: meal.type,
    });
    if (error) console.warn("카카오 공유창 실행 횟수를 기록하지 못했습니다.", error.message);
  } catch (error) {
    console.warn("카카오 공유창 실행 기록을 건너뜁니다.", error?.message || error);
  }
};

export const openMealKakaoSharePicker = (meal) => {
  const templateArgs = buildKakaoTemplateArgs(meal);
  const kakao = getKakaoSdk();
  kakao.Share.sendCustom({ templateId: TEMPLATE_ID, templateArgs });
  void recordAuthenticatedPickerOpen(meal);
  return { opened: true, templateId: TEMPLATE_ID, templateArgs };
};
