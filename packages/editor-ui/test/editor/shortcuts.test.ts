// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  editorShortcuts,
  registerEditorShortcuts,
  shortcutLabel,
  shortcutLabels,
} from "../../src/editor/shortcuts";

let dispose = () => {};

afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const setup = (platform = "MacIntel") => {
  vi.stubGlobal("navigator", { platform });
  const root = document.createElement("div");
  document.body.append(root);
  const run = vi.fn(() => true);
  dispose = registerEditorShortcuts(root, run);
  return { root, run };
};

const press = (
  key: string,
  options: KeyboardEventInit = {},
  target: EventTarget = document.body,
) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
};

describe("editor keymap", () => {
  it.each([
    ["b", { metaKey: true }, "toggle-navigation"],
    ["r", { metaKey: true }, "toggle-inspector"],
    ["ArrowLeft", { metaKey: true }, "previous-tab"],
    ["ArrowRight", { metaKey: true }, "next-tab"],
    ["w", { ctrlKey: true }, "close-tab"],
    ["\\", { metaKey: true }, "split-horizontal"],
    ["Escape", { shiftKey: true }, "toggle-pane-zoom"],
    [".", { metaKey: true }, "create-node"],
    [".", { ctrlKey: true }, "create-node"],
    ["[", { metaKey: true, altKey: true }, "fold-pins"],
    ["[", { ctrlKey: true, altKey: true }, "fold-pins"],
    ["]", { metaKey: true, altKey: true }, "expand-pins"],
    ["]", { ctrlKey: true, altKey: true }, "expand-pins"],
    ["Backspace", {}, "delete-selection"],
    ["Delete", {}, "delete-selection"],
    ["Escape", {}, "cancel"],
  ])("ports %s %j as %s", (key, options, action) => {
    const { run } = setup();
    expect(press(key, options).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledExactlyOnceWith(action);
  });

  it.each(["Win32", "Linux x86_64"])("uses Ctrl as the primary modifier on %s", (platform) => {
    const { run } = setup(platform);
    press("b", { ctrlKey: true });
    press("r", { ctrlKey: true });
    press("w", { ctrlKey: true });
    expect(run.mock.calls).toEqual([["toggle-navigation"], ["toggle-inspector"], ["close-tab"]]);
    expect(press("b", { metaKey: true }).defaultPrevented).toBe(false);
  });

  it("keeps the existing editor's additional bindings", () => {
    const { run } = setup();
    press("i", { metaKey: true });
    press("w", { metaKey: true });
    press("e", { metaKey: true });
    press("Escape", { metaKey: true, shiftKey: true });
    press("0", { metaKey: true });
    expect(run.mock.calls).toEqual([
      ["toggle-inspector"],
      ["close-tab"],
      ["toggle-pins"],
      ["toggle-pane-zoom"],
      ["reset-view"],
    ]);
  });

  it("uses physical codes when Shift or Option changes the key's character", () => {
    const { run } = setup();
    press("|", { code: "Backslash", metaKey: true, shiftKey: true });
    press("\u201c", { code: "BracketLeft", metaKey: true, altKey: true });
    press("\u2018", { code: "BracketRight", metaKey: true, altKey: true });
    expect(run.mock.calls).toEqual([["split-vertical"], ["fold-pins"], ["expand-pins"]]);
  });

  it("does not claim unmatched, conflicting, composing, or already handled keys", () => {
    const { run } = setup();
    expect(press("b").defaultPrevented).toBe(false);
    expect(press("b", { metaKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(press("b", { metaKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press("b", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press("b", { metaKey: true, isComposing: true }).defaultPrevented).toBe(false);
    const handled = new KeyboardEvent("keydown", {
      key: "b",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "select", "contenteditable"])(
    "protects %s while allowing Escape to dismiss a menu",
    (tag) => {
      const { root, run } = setup();
      const input = document.createElement(tag === "contenteditable" ? "div" : tag);
      if (tag === "contenteditable") input.contentEditable = "true";
      root.append(input);
      expect(press("Backspace", {}, input).defaultPrevented).toBe(false);
      expect(press("r", { metaKey: true }, input).defaultPrevented).toBe(false);
      expect(press(".", { metaKey: true }, input).defaultPrevented).toBe(false);
      expect(press("[", { ctrlKey: true, altKey: true }, input).defaultPrevented).toBe(false);
      expect(run).not.toHaveBeenCalled();
      expect(press("Escape", {}, input).defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledExactlyOnceWith("cancel");
    },
  );

  it("ignores other UI, hidden editors and disconnected roots", () => {
    const { root, run } = setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    expect(press("b", { metaKey: true }, outside).defaultPrevented).toBe(false);
    root.hidden = true;
    expect(press("b", { metaKey: true }).defaultPrevented).toBe(false);
    root.hidden = false;
    root.remove();
    expect(press("b", { metaKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("only prevents default and propagation when the action can run", () => {
    const { run } = setup();
    const listener = vi.fn();
    window.addEventListener("keydown", listener);
    try {
      run.mockReturnValue(false);
      expect(press("Escape").defaultPrevented).toBe(false);
      expect(listener).toHaveBeenCalledOnce();
      run.mockReturnValue(true);
      expect(press("Escape").defaultPrevented).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });

  it("blocks every editor action while the shortcuts dialog is open, including body events", () => {
    const { root, run } = setup();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("data-editor-shortcuts", "");
    dialog.open = true;
    const button = document.createElement("button");
    dialog.append(button);
    root.append(dialog);
    for (const target of [button, document.body]) {
      expect(press("b", { metaKey: true }, target).defaultPrevented).toBe(false);
      expect(press("Backspace", {}, target).defaultPrevented).toBe(false);
      expect(press("Escape", {}, target).defaultPrevented).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
    dialog.open = false;
    press("b", { metaKey: true });
    expect(run).toHaveBeenCalledExactlyOnceWith("toggle-navigation");
  });

  it("lists platform aliases without duplicate or non-Apple Command bindings", () => {
    expect(shortcutLabels("toggle-inspector", true)).toEqual(["\u2318R", "\u2318I"]);
    expect(shortcutLabels("close-tab", true)).toEqual(["Ctrl+W", "\u2318W"]);
    expect(shortcutLabels("close-tab", false)).toEqual(["Ctrl+W"]);
    expect(shortcutLabels("create-node", true)).toEqual(["\u2318.", "Ctrl+."]);
    expect(shortcutLabels("create-node", false)).toEqual(["Ctrl+."]);
    expect(shortcutLabels("delete-selection", false)).toEqual(["Backspace", "Delete"]);
    expect(shortcutLabels("toggle-pane-zoom", false)).toEqual([
      "Shift+Escape",
      "Ctrl+Shift+Escape",
    ]);
    for (const { action } of editorShortcuts) {
      expect(shortcutLabels(action, true).length).toBeGreaterThan(0);
      expect(shortcutLabels(action, false).length).toBeGreaterThan(0);
    }
  });

  it("removes host listeners on disposal and can be mounted again", () => {
    const { root, run } = setup();
    const remove = vi.spyOn(document.body, "removeEventListener");
    dispose();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["keydown", "keyup", "focusin", "focusout"]),
    );
    expect(press("b", { metaKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    dispose = registerEditorShortcuts(root, run);
    press("b", { metaKey: true });
    expect(run).toHaveBeenCalledExactlyOnceWith("toggle-navigation");
    remove.mockRestore();
  });

  it("derives hints from the primary bindings", () => {
    expect(shortcutLabel("toggle-inspector", true)).toBe("\u2318R");
    expect(shortcutLabel("toggle-navigation", false)).toBe("Ctrl+B");
    expect(shortcutLabel("close-tab", true)).toBe("Ctrl+W");
    expect(shortcutLabel("toggle-pane-zoom", true)).toBe("Shift+Escape");
    expect(shortcutLabel("split-vertical", false)).toBe("Ctrl+Shift+\\");
    expect(shortcutLabel("create-node", false)).toBe("Ctrl+.");
    expect(shortcutLabel("fold-pins", false)).toBe("Ctrl+Alt+[");
  });
});
