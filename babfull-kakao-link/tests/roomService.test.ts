import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectRoomCapability } from "../src/rooms/roomService.js";

describe("inspectRoomCapability", () => {
  it("검증되지 않은 채팅방 조회를 지원한다고 표시하지 않는다", () => {
    const report = inspectRoomCapability();
    assert.equal(report.supported, false);
    assert.match(report.reason, /공식 API는 일반 단체 채팅방 목록 조회를 지원하지 않습니다/);
    assert.match(report.reason, /공개 listRooms\(\)가 없/);
  });
});
