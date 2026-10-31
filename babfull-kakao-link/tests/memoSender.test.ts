import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendMemoToSelf } from "../src/senders/memoSender.js";

const request = {
  accessToken: "secret-access-token",
  templateId: 138483,
  templateArgs: {
    time: "중식",
    month: "11",
    day: "2",
    menuText: "백미밥, 김치",
    image: "https://example.com/lunch.png",
  },
};

describe("sendMemoToSelf", () => {
  it("정확한 템플릿 ID와 이미지 URL을 포함한 사용자 인자를 form-urlencoded로 전송한다", async () => {
    const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({ result_code: 0 }), { status: 200 });
    };
    await sendMemoToSelf(request, fetcher as typeof fetch);

    const [url, options] = calls[0]!;
    assert.equal(url, "https://kapi.kakao.com/v2/api/talk/memo/send");
    const form = options?.body as URLSearchParams;
    assert.equal(form.get("template_id"), "138483");
    assert.deepEqual(JSON.parse(form.get("template_args")!), request.templateArgs);
    assert.deepEqual(Object.keys(JSON.parse(form.get("template_args")!)), ["time", "month", "day", "menuText", "image"]);
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer secret-access-token");
  });

  it("카카오 실패 응답을 성공으로 처리하지 않는다", async () => {
    const fetcher = async () => new Response(JSON.stringify({ code: -3, msg: "forbidden" }), { status: 403 });
    await assert.rejects(sendMemoToSelf(request, fetcher as typeof fetch), /나에게 보내기 실패 \(403/);
  });
});
