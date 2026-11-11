/** 로컬에서만 광고 영역의 반응형 크기와 겹침을 확인하는 시각적 미리보기입니다. 실제 광고 요청은 보내지 않습니다. */
const isLocalhost = () => ["localhost", "127.0.0.1"].includes(window.location.hostname);

export const initLocalAdPreview = () => {
  const enabled = isLocalhost() && new URLSearchParams(window.location.search).get("ad-preview") === "1";
  if (!enabled) return false;
  const slot = document.querySelector(".top-banner-slot");
  if (!slot) return false;
  slot.dataset.bannerMode = "ad-preview";
  slot.innerHTML = `<aside class="local-ad-preview" aria-label="광고 미리보기">
    <span class="local-ad-preview__label">광고 미리보기</span>
    <div class="local-ad-preview__mark" aria-hidden="true">AD</div>
    <div class="local-ad-preview__copy">
      <strong>이곳에 반응형 광고가 표시됩니다</strong>
      <span>실제 광고 소재가 아닌 레이아웃 확인용 화면입니다.</span>
    </div>
    <span class="local-ad-preview__size">반응형</span>
  </aside>`;
  return true;
};
