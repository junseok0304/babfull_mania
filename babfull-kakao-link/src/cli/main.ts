import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getAccessToken } from "../auth/kakaoAuth.js";
import { getKakaoConfig } from "../config/env.js";
import { inspectRoomCapability } from "../rooms/roomService.js";
import { sendMemoToSelf } from "../senders/memoSender.js";
import { formatMenuText } from "../templates/menuFormatter.js";

const SAMPLE_MENUS = [
  "백미밥",
  "우동장국",
  "쫄면",
  "김말이&만두튀김",
  "풋고추된장무침",
  "김치",
  "마카로니샐러드",
] as const;

const SAMPLE_DATE = {
  month: "10",
  day: "30",
} as const;

const SAMPLE_IMAGE_URL =
  "https://uupatosmuueifsssdkev.supabase.co/storage/v1/object/public/meal-tray-images/2026-10-30/lunch-127-1792979390136-pqlkue.png";

function printHeader(): void {
  console.log(`
=================================
   Babfull KakaoLink CLI
=================================

1. 나에게 메시지 보내기
2. 채팅방 목록 조회 가능 여부
0. 종료
`);
}

export async function runCli(): Promise<void> {
  const cli = createInterface({ input: stdin, output: stdout });
  try {
    printHeader();
    const choice = (await cli.question("선택 > ")).trim();
    if (choice === "0") return;

    if (choice === "2") {
      const report = inspectRoomCapability();
      console.log(`\n[검증 결과]\n지원 상태: 미지원\n사유: ${report.reason}`);
      return;
    }

    if (choice !== "1") throw new Error("지원하지 않는 메뉴 번호입니다.");

    const config = getKakaoConfig();
    const templateArgs = {
      time: "중식",
      month: SAMPLE_DATE.month,
      day: SAMPLE_DATE.day,
      menuText: formatMenuText(SAMPLE_MENUS),
      image: SAMPLE_IMAGE_URL,
    };

    console.log(`
[발송 전 확인]
대상: 내 카카오톡 나와의 채팅
템플릿 ID: ${config.templateId}
월/일: ${templateArgs.month}월 ${templateArgs.day}일
메뉴:
${templateArgs.menuText}
`);
    const confirmed = (await cli.question("전송하시겠습니까? (y/n) > ")).trim().toLowerCase();
    if (confirmed !== "y") {
      console.log("전송을 취소했습니다.");
      return;
    }

    const accessToken = await getAccessToken(config);
    console.log("전송 요청 중...");
    await sendMemoToSelf({
      accessToken,
      templateId: config.templateId,
      templateArgs,
    });
    console.log("카카오 API가 전송 성공(result_code=0)을 반환했습니다. 실제 카카오톡 수신을 확인해 주세요.");
  } finally {
    cli.close();
  }
}
