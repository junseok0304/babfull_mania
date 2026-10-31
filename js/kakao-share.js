import { clearKakaoProviderToken, getAuthState, getKakaoProviderToken, signInWithKakao } from "./auth.js?v=20261031-4";
import { buildKakaoTemplateArgs } from "./kakao-message.js?v=20261031-3";

const TEMPLATE_ID = 138483;

export class KakaoShareAuthError extends Error {}

export const sendMealToKakaoSelf = async (meal) => {
  const { available, session, error } = await getAuthState();
  if (error) throw error;
  if (!available) throw new Error("로그인 서비스를 사용할 수 없습니다.");
  if (!session?.user) throw new KakaoShareAuthError("카카오 로그인이 필요합니다.");

  const providerToken = getKakaoProviderToken(session);
  if (!providerToken) throw new KakaoShareAuthError("카카오 메시지 권한을 다시 연결해야 합니다.");

  const response = await fetch("/api/kakao-memo", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateId: TEMPLATE_ID,
      templateArgs: buildKakaoTemplateArgs(meal),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || payload.reauthRequired) {
      throw new KakaoShareAuthError(payload.error || "카카오 메시지 권한이 만료되었습니다.");
    }
    throw new Error(payload.error || "카카오톡 메시지를 보내지 못했습니다.");
  }
  let tracked = false;
  try {
    const { error: trackingError } = await client.rpc("record_kakao_share", {
      target_meal_date: meal.date,
      target_meal_type: meal.type,
    });
    if (trackingError) console.warn("카카오 공유 횟수를 기록하지 못했습니다.", trackingError.message);
    else tracked = true;
  } catch (trackingError) {
    console.warn("카카오 공유 횟수 기록 요청이 중단됐습니다.", trackingError?.message || trackingError);
  }
  return { ...payload, tracked };
};

export const reconnectKakaoForMessage = () => {
  clearKakaoProviderToken();
  return signInWithKakao({
    returnRoute: "home",
    scopes: "talk_message",
  });
};
