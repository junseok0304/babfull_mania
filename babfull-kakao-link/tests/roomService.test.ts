import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inspectRoomCapability,
  normalizeRooms,
  UnofficialRoomClient,
} from "../src/rooms/roomService.js";

describe("inspectRoomCapability", () => {
  it("비공식 로컬 실험 기능임을 명시한다", () => {
    const report = inspectRoomCapability();
    assert.equal(report.supported, "experimental");
    assert.match(report.reason, /공식 API 기능은 아니지만/);
    assert.match(report.reason, /로컬 1회 테스트/);
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
