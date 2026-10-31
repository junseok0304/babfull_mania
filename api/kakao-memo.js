const TEMPLATE_ID = 138483;
const IMAGE_HOST = "uupatosmuueifsssdkev.supabase.co";

const parseBody = (body) => {
  if (typeof body === "string") return JSON.parse(body);
  return body || {};
};

const validTemplateArgs = (args) => {
  if (!args || !["조식", "중식"].includes(args.time)) return false;
  if (!/^\d{1,2}$/.test(args.month) || !/^\d{1,2}$/.test(args.day)) return false;
  if (typeof args.menuText2 !== "string" || typeof args.menuText !== "string") return false;
  if (!`${args.menuText2}${args.menuText}`.trim() || args.menuText2.length > 500 || args.menuText.length > 500) return false;
  try {
    const imageUrl = new URL(args.image);
    return imageUrl.protocol === "https:" && imageUrl.hostname === IMAGE_HOST;
  } catch {
    return false;
  }
};

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ error: "허용되지 않은 요청입니다." });

  const authorization = request.headers.authorization || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return response.status(401).json({ error: "카카오 로그인이 필요합니다.", reauthRequired: true });

  let body;
  try {
    body = parseBody(request.body);
  } catch {
    return response.status(400).json({ error: "요청 형식이 올바르지 않습니다." });
  }
  if (Number(body.templateId) !== TEMPLATE_ID || !validTemplateArgs(body.templateArgs)) {
    return response.status(400).json({ error: "메시지 템플릿 데이터가 올바르지 않습니다." });
  }

  const kakaoResponse = await fetch("https://kapi.kakao.com/v2/api/talk/memo/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: new URLSearchParams({
      template_id: String(TEMPLATE_ID),
      template_args: JSON.stringify(body.templateArgs),
    }),
  });
  const payload = await kakaoResponse.json().catch(() => ({}));
  if (!kakaoResponse.ok || payload.result_code !== 0) {
    const reauthRequired = kakaoResponse.status === 401 || [-401, -402].includes(payload.code);
    return response.status(reauthRequired ? 401 : 502).json({
      error: reauthRequired ? "카카오 메시지 권한을 다시 연결해 주세요." : "카카오톡 메시지 전송에 실패했습니다.",
      reauthRequired,
    });
  }
  return response.status(200).json({ success: true });
};
