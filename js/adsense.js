/** 홈 공지 배너 위치의 AdSense 광고를 운영 설정에 따라 지연 로드합니다. */
export const ADSENSE_CLIENT_ID = "ca-pub-9030402652749847";

export const normalizeAdsenseSettings = (value = {}) => {
  const slotId = String(value.slotId ?? value.slot_id ?? "").trim();
  return {
    enabled: value.enabled === true,
    slotId: /^\d{6,20}$/.test(slotId) ? slotId : "",
  };
};

const isLocalhost = () => ["localhost", "127.0.0.1"].includes(window.location.hostname);

const renderLocalPreview = (slot) => {
  slot.dataset.bannerMode = "ad-preview";
  slot.innerHTML = `<aside class="local-ad-preview" aria-label="광고 미리보기">
    <span class="local-ad-preview__label">광고 미리보기</span>
    <div class="local-ad-preview__mark" aria-hidden="true">AD</div>
    <div class="local-ad-preview__copy"><strong>홈 배너 광고가 표시되는 영역입니다</strong><span>실제 광고 요청 없이 반응형 크기만 확인합니다.</span></div>
    <span class="local-ad-preview__size">반응형</span>
  </aside>`;
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

export const initAdsenseBanner = (rawSettings = {}) => {
  const settings = normalizeAdsenseSettings(rawSettings);
  const slot = document.querySelector(".top-banner-slot");
  if (!slot || !settings.enabled || !settings.slotId) return false;

  if (isLocalhost() && new URLSearchParams(window.location.search).get("ad-preview") === "1") {
    renderLocalPreview(slot);
    return true;
  }

  slot.dataset.bannerMode = "advertisement";
  slot.innerHTML = `<ins class="adsbygoogle babfull-banner-ad"
    aria-label="광고"
    style="display:block"
    data-ad-client="${ADSENSE_CLIENT_ID}"
    data-ad-slot="${settings.slotId}"
    data-ad-format="auto"
    data-full-width-responsive="true"></ins>`;

  loadAdsenseScript()
    .then(() => {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
      catch (error) { console.warn("홈 배너 광고를 초기화하지 못했습니다.", error); }
    })
    .catch((error) => console.warn(error.message));
  return true;
};
