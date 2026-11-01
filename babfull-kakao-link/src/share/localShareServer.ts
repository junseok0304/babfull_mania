import { createServer } from "node:http";
import { getKakaoConfig, getKakaoShareConfig } from "../config/env.js";
import { formatMenuTemplateVariables } from "../templates/menuFormatter.js";

const HOST = "127.0.0.1";
const PORT = 4400;
const LOCAL_URL = `http://localhost:${PORT}`;
const SAMPLE_MENUS = [
  "백미밥",
  "우동장국",
  "쫄면",
  "김말이&만두튀김",
  "풋고추된장무침",
  "김치",
  "마카로니샐러드",
] as const;
const SAMPLE_IMAGE_URL =
  "https://uupatosmuueifsssdkev.supabase.co/storage/v1/object/public/meal-tray-images/2026-10-30/lunch-127-1792979390136-pqlkue.png";

export interface LocalSharePageOptions {
  javascriptKey: string;
  templateId: number;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function renderLocalSharePage(options: LocalSharePageOptions): string {
  const menu = formatMenuTemplateVariables(SAMPLE_MENUS);
  const templateArgs = {
    time: "중식",
    menuText2: menu.menuText2,
    menuText: menu.menuText,
    day: "30",
    image: SAMPLE_IMAGE_URL,
    month: "10",
  };
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>밥풀매니아 카카오톡 공유 테스트</title>
  <script src="https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js" integrity="sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w" crossorigin="anonymous"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #faf7f3; color: #191716; font-family: -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif; }
    main { width: min(100%, 560px); padding: 32px; border: 1px solid #eadfd7; border-radius: 24px; background: #fff; box-shadow: 0 18px 50px rgba(86, 56, 37, .1); }
    .eyebrow { color: #a6492f; font-weight: 800; }
    h1 { margin: 8px 0 10px; font-size: clamp(28px, 6vw, 40px); }
    p { color: #716a66; line-height: 1.6; }
    .meal { margin: 24px 0; padding: 20px; border-radius: 16px; background: #fff4ed; }
    .meal strong { display: block; margin-bottom: 10px; font-size: 20px; }
    .menu { line-height: 1.7; }
    button { width: 100%; min-height: 52px; border: 0; border-radius: 14px; background: #fee500; color: #191919; font-size: 18px; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: .5; cursor: wait; }
    #status { min-height: 24px; margin: 14px 0 0; color: #a6492f; font-weight: 700; text-align: center; }
    .note { margin-top: 20px; padding-top: 18px; border-top: 1px solid #eee5df; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <span class="eyebrow">로컬 공식 SDK 테스트</span>
    <h1>카카오톡 공유</h1>
    <p>아래 버튼을 누르면 카카오 공식 공유창이 열립니다. 공유창에서 실제 친구 또는 채팅방을 직접 선택해 주세요.</p>
    <section class="meal">
      <strong>10월 30일 중식</strong>
      <div class="menu">${SAMPLE_MENUS.join(" · ")}</div>
    </section>
    <button id="share" type="button">카카오톡 공유창 열기</button>
    <div id="status" role="status" aria-live="polite"></div>
    <p class="note">공식 공유창에서 선택을 완료하기 전에는 메시지가 전송되지 않습니다. 이 페이지와 서버는 현재 컴퓨터에서만 열립니다.</p>
  </main>
  <script>
    const button = document.getElementById("share");
    const status = document.getElementById("status");
    const templateArgs = ${safeJson(templateArgs)};
    try {
      Kakao.init(${safeJson(options.javascriptKey)});
      status.textContent = Kakao.isInitialized() ? "공유 준비가 완료됐습니다." : "SDK 초기화에 실패했습니다.";
    } catch (error) {
      status.textContent = "SDK 초기화 오류: " + (error?.message || String(error));
      button.disabled = true;
    }
    button.addEventListener("click", () => {
      status.textContent = "카카오 공식 공유창을 여는 중입니다…";
      try {
        Kakao.Share.sendCustom({ templateId: ${options.templateId}, templateArgs });
        window.setTimeout(() => { status.textContent = "공유창에서 전송할 채팅방을 선택해 주세요."; }, 500);
      } catch (error) {
        status.textContent = "공유창 오류: " + (error?.message || String(error));
      }
    });
  </script>
</body>
</html>`;
}

export function startLocalShareServer(): void {
  const kakao = getKakaoConfig();
  const share = getKakaoShareConfig();
  const html = renderLocalSharePage({ javascriptKey: share.javascriptKey, templateId: kakao.templateId });
  const server = createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/favicon.ico") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://t1.kakaocdn.net; connect-src 'self' https://*.kakao.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-src https://*.kakao.com;",
    });
    response.end(html);
  });
  server.listen(PORT, HOST, () => {
    console.log(`\n밥풀매니아 공식 카카오 공유 테스트: ${LOCAL_URL}`);
    console.log("종료하려면 Ctrl+C를 누르세요.\n");
  });
}
