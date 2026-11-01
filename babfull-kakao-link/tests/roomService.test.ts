import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inspectRoomCapability,
  normalizeRooms,
  UnofficialRoomClient,
} from "../src/rooms/roomService.js";

describe("inspectRoomCapability", () => {
  it("실제 검증에서 차단된 비공식 기능임을 명시한다", () => {
    const report = inspectRoomCapability();
    assert.equal(report.supported, false);
    assert.match(report.reason, /공식 API 기능이 아니/);
    assert.match(report.reason, /status=-404/);
  });

  it("공유 피커 응답에서 유효한 방만 정규화한다", () => {
    assert.deepEqual(
      normalizeRooms([
        { id: "room-1", title: " 테스트방 ", memberCount: 3 },
        { id: 7, title: "잘못된 방" },
        { id: "room-2", title: "" },
      ]),
      [{ id: "room-1", title: "테스트방", memberCount: 3 }],
    );
  });

  it("REST 키 대신 32자리 JavaScript 키만 허용한다", () => {
    assert.throws(() => new UnofficialRoomClient("short", "https://example.com"), /32자리 JavaScript 키/);
  });
});
