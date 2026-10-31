export interface MenuTemplateArgs {
  time: string;
  month: string;
  day: string;
  menuText: string;
  image: string;
}

export interface MemoSendRequest {
  accessToken: string;
  templateId: number;
  templateArgs: MenuTemplateArgs;
}

interface KakaoMemoResponse {
  result_code?: number;
  code?: number;
  msg?: string;
}

export async function sendMemoToSelf(
  request: MemoSendRequest,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const form = new URLSearchParams({
    template_id: String(request.templateId),
    template_args: JSON.stringify(request.templateArgs),
  });
  const response = await fetcher("https://kapi.kakao.com/v2/api/talk/memo/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: form,
  });
  const payload = (await response.json()) as KakaoMemoResponse;
  if (!response.ok || payload.result_code !== 0) {
    throw new Error(
      `나에게 보내기 실패 (${response.status}, code=${payload.code ?? "없음"}): ${payload.msg ?? "알 수 없는 오류"}`,
    );
  }
}
