import { buildKakaoTemplateArgs } from "./kakao-message.js?v=20261101-1";
import { getAuthState } from "./auth.js?v=20261101-1";

// JavaScript 키는 브라우저에 공개되는 플랫폼 키이며 등록 도메인에서만 사용할 수 있다.
const KAKAO_JAVASCRIPT_KEY = "38a2a6d37a352a1a567f10ee8d1a0cec";
const TEMPLATE_ID = 138483;
const KAKAO_SDK_URL = "/vendor/kakao-sdk.js?v=2.8.4";
let shareButtonSequence = 0;
let kakaoSdkPromise = null;

const loadKakaoSdk = () => {
  if (window.Kakao) return Promise.resolve(window.Kakao);
  if (kakaoSdkPromise) return kakaoSdkPromise;

  kakaoSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = KAKAO_SDK_URL;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.Kakao) resolve(window.Kakao);
      else reject(new Error("카카오톡 공유 기능을 초기화하지 못했습니다. 페이지를 새로고침해 주세요."));
    }, { once: true });
    script.addEventListener("error", () => {
      reject(new Error("카카오톡 공유 기능을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요."));
    }, { once: true });
    document.head.append(script);
  }).catch((error) => {
    kakaoSdkPromise = null;
    throw error;
  });

  return kakaoSdkPromise;
};

const getKakaoSdk = (methodName) => {
  const kakao = window.Kakao;
  if (!kakao?.Share?.[methodName]) {
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
  const kakao = getKakaoSdk("sendCustom");
  kakao.Share.sendCustom({ templateId: TEMPLATE_ID, templateArgs });
  void recordAuthenticatedPickerOpen(meal);
  return { opened: true, templateId: TEMPLATE_ID, templateArgs };
};

// SDK가 실제 사용자 클릭 이벤트를 직접 처리하도록 연결한다.
// 모바일 브라우저의 앱 실행·팝업 제한에 가장 안정적인 공식 연결 방식이다.
export const bindMealKakaoSharePicker = async (button, meal) => {
  if (!button) throw new Error("카카오 공유 버튼을 찾지 못했습니다.");
  const templateArgs = buildKakaoTemplateArgs(meal);
  button.disabled = true;
  button.setAttribute?.("aria-busy", "true");
  await loadKakaoSdk();
  const kakao = getKakaoSdk("createCustomButton");

  if (!button.id) {
    shareButtonSequence += 1;
    button.id = `kakao-share-button-${shareButtonSequence}`;
  }

  kakao.Share.createCustomButton({
    container: `#${button.id}`,
    templateId: TEMPLATE_ID,
    templateArgs,
  });
  button.disabled = false;
  button.removeAttribute?.("aria-busy");
  button.addEventListener?.("click", () => void recordAuthenticatedPickerOpen(meal));

  return { bound: true, templateId: TEMPLATE_ID, templateArgs };
};
