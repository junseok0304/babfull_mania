/** Google AdSense 자동 광고 코드를 운영 설정에 따라 문서 head에 지연 로드합니다. */
export const ADSENSE_CLIENT_ID = "ca-pub-9030402652749847";

export const normalizeAdsenseSettings = (value = {}) => {
  return { enabled: value.enabled === true };
};

const loadAdsenseScript = () => {
  const existing = document.querySelector(`script[data-babfull-adsense="${ADSENSE_CLIENT_ID}"]`);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
    script.dataset.babfullAdsense = ADSENSE_CLIENT_ID;
    script.addEventListener("load", () => resolve(script), { once: true });
    script.addEventListener("error", () => reject(new Error("광고 스크립트를 불러오지 못했습니다.")), { once: true });
    document.head.append(script);
  });
};

export const initAdsenseAutoAds = (rawSettings = {}) => {
  const settings = normalizeAdsenseSettings(rawSettings);
  if (!settings.enabled) return false;
  loadAdsenseScript().catch((error) => console.warn(error.message));
  return true;
};
