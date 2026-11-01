import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderLocalSharePage } from "../src/share/localShareServer.js";

describe("renderLocalSharePage", () => {
  it("공식 SDK와 커스텀 템플릿 인자를 포함한다", () => {
    const html = renderLocalSharePage({ javascriptKey: "a".repeat(32), templateId: 138483 });
    assert.match(html, /kakao_js_sdk\/2\.8\.4\/kakao\.min\.js/);
    assert.match(html, /Kakao\.Share\.sendCustom/);
    assert.match(html, /templateId: 138483/);
    for (const key of ["time", "menuText2", "menuText", "day", "image", "month"]) {
      assert.match(html, new RegExp(`&quot;${key}&quot;|"${key}"`));
    }
  });
});
