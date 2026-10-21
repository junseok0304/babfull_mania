module.exports = function handler(_request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  return response.status(400).send(`<!doctype html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>400 · 관리자 접근 거부</title>
<style>body{margin:0;background:#f4f7f5;color:#18181b;font-family:system-ui,sans-serif}main{min-height:100vh;display:grid;place-content:center;justify-items:center;padding:24px;text-align:center}span{color:#14532d;font-size:72px;font-weight:900}h1{margin:4px 0 8px}p{margin:0 0 22px;color:#71717a}a{padding:12px 18px;border-radius:10px;background:#166534;color:white;text-decoration:none;font-weight:800}</style></head>
<body><main><span>400</span><h1>잘못된 요청입니다</h1><p>활성 관리자 계정으로 로그인해야 접근할 수 있습니다.</p><a href="/#home">사용자 화면으로 돌아가기</a></main></body></html>`);
};
