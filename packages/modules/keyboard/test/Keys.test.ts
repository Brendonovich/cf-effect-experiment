import { assert, describe, it } from "@effect/vitest";

import * as Keys from "../src/Keys.ts";

describe("Keyboard keys", () => {
  it("parses key names case-insensitively, with aliases", () => {
    assert.strictEqual(Keys.parse("a"), "A");
    assert.strictEqual(Keys.parse(" f5 "), "F5");
    assert.strictEqual(Keys.parse("space"), "Space");
    assert.strictEqual(Keys.parse("Esc"), "Escape");
    assert.strictEqual(Keys.parse("cmd"), "Meta");
    assert.strictEqual(Keys.parse("up"), "ArrowUp");
    assert.strictEqual(Keys.parse("/"), "Slash");
    assert.strictEqual(Keys.parse("numpad0"), "Numpad0");
    assert.isUndefined(Keys.parse("Hyper"));
    assert.isUndefined(Keys.parse(""));
  });

  it("maps browser key codes by physical position", () => {
    assert.strictEqual(Keys.fromBrowserCode("KeyQ"), "Q");
    assert.strictEqual(Keys.fromBrowserCode("Digit7"), "7");
    assert.strictEqual(Keys.fromBrowserCode("ShiftRight"), "Shift");
    assert.strictEqual(Keys.fromBrowserCode("MetaLeft"), "Meta");
    assert.strictEqual(Keys.fromBrowserCode("ArrowLeft"), "ArrowLeft");
    assert.strictEqual(Keys.fromBrowserCode("NumpadEnter"), "NumpadEnter");
    assert.strictEqual(Keys.fromBrowserCode("F24"), "F24");
    assert.isUndefined(Keys.fromBrowserCode("KeyboardLayoutSpecific"));
    assert.isUndefined(Keys.fromBrowserCode("MediaPlayPause"));
  });

  it("maps libuiohook key codes, merging left and right modifiers", () => {
    assert.strictEqual(Keys.fromUiohookCode(0x001e), "A");
    assert.strictEqual(Keys.fromUiohookCode(0x000b), "0");
    assert.strictEqual(Keys.fromUiohookCode(0x0002), "1");
    assert.strictEqual(Keys.fromUiohookCode(0x001d), "Ctrl");
    assert.strictEqual(Keys.fromUiohookCode(0x0e1d), "Ctrl");
    assert.strictEqual(Keys.fromUiohookCode(0xe048), "ArrowUp");
    assert.strictEqual(Keys.fromUiohookCode(0xee4f), "Numpad1");
    assert.isUndefined(Keys.fromUiohookCode(0xffff));
  });

  it("only produces names that keybinds can parse", () => {
    for (const name of Keys.names) assert.strictEqual(Keys.parse(name), name);
    for (let code = 0; code <= 0xffff; code++) {
      const name = Keys.fromUiohookCode(code);
      if (name !== undefined) assert.include(Keys.names, name);
    }
  });
});
