import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getAccessToken } from "../auth/kakaoAuth.js";
import { getKakaoConfig, getKakaoRoomConfig } from "../config/env.js";
import { inspectRoomCapability, UnofficialRoomClient } from "../rooms/roomService.js";
import { sendMemoToSelf } from "../senders/memoSender.js";
import { formatMenuTemplateVariables } from "../templates/menuFormatter.js";

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
2. 채팅방 목록 조회 실험 (비공식·현재 차단 확인)
0. 종료
`);
}

export async function runCli(): Promise<void> {
  const cli = createInterface({ input: stdin, output: stdout });
  try {
    printHeader();
    const choice = (await cli.question("선택 > ")).trim();
    if (choice === "0") return;

    const config = getKakaoConfig();
    const menuVariables = formatMenuTemplateVariables(SAMPLE_MENUS);
    const templateArgs = {
      time: "중식",
      month: SAMPLE_DATE.month,
      day: SAMPLE_DATE.day,
      menuText2: menuVariables.menuText2,
      menuText: menuVariables.menuText,
      image: SAMPLE_IMAGE_URL,
    };

    if (choice === "2") {
      const report = inspectRoomCapability();
      const roomConfig = getKakaoRoomConfig();
      console.log(`
[주의]
${report.reason}
계정 비밀번호는 로컬 .env에서만 읽으며 출력하거나 저장하지 않습니다.
추가 인증·CAPTCHA가 요구되면 우회하지 않고 중단합니다.
`);
      const client = new UnofficialRoomClient(roomConfig.javascriptKey, roomConfig.shareDomain);
      console.log("카카오 로그인 및 실제 채팅방 목록 조회 중...");
      await client.login(roomConfig.accountEmail, roomConfig.accountPassword);
      const rooms = await client.listRooms({
        link_ver: "4.0",
        template_id: config.templateId,
        template_args: templateArgs,
      });
      if (rooms.length === 0) {
        console.log("조회된 채팅방이 없습니다. 전송하지 않았습니다.");
        return;
      }

      console.log("\n[채팅방 목록]");
      rooms.forEach((room, index) => console.log(`${index + 1}. ${room.title}`));
      const roomNumber = Number((await cli.question("\n전송할 채팅방 번호 > ")).trim());
      if (!Number.isInteger(roomNumber) || roomNumber < 1 || roomNumber > rooms.length) {
        throw new Error("올바른 채팅방 번호를 입력해 주세요.");
      }
      const selectedRoom = rooms[roomNumber - 1];
      console.log(`
[발송 전 확인]
선택한 채팅방: ${selectedRoom.title}
템플릿 ID: ${config.templateId}
월/일: ${templateArgs.month}월 ${templateArgs.day}일 ${templateArgs.time}
메뉴:
${templateArgs.menuText2}
${templateArgs.menuText}
`);
      const confirmed = (await cli.question("이 채팅방에 한 번 전송하시겠습니까? (y/n) > "))
        .trim()
        .toLowerCase();
      if (confirmed !== "y") {
        console.log("전송을 취소했습니다.");
        return;
      }
      console.log("전송 요청 중...");
      await client.sendToRoom(selectedRoom.id);
      console.log("카카오 공유 피커가 성공 응답을 반환했습니다. 선택한 채팅방의 실제 수신을 확인해 주세요.");
      return;
    }

    if (choice !== "1") throw new Error("지원하지 않는 메뉴 번호입니다.");

    console.log(`
[발송 전 확인]
대상: 내 카카오톡 나와의 채팅
템플릿 ID: ${config.templateId}
월/일: ${templateArgs.month}월 ${templateArgs.day}일
메뉴:
${templateArgs.menuText2}
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
