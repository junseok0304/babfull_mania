export interface RoomCapabilityReport {
  supported: false;
  reason: string;
}

export function inspectRoomCapability(): RoomCapabilityReport {
  return {
    supported: false,
    reason:
      "카카오 공식 API는 일반 단체 채팅방 목록 조회를 지원하지 않습니다. 참고 kakao-link 패키지에도 공개 listRooms()가 없으며, 비공식 공유 피커 내부 API를 send() 도중 사용하는 구조라 별도 검증 전에는 제공하지 않습니다.",
  };
}
