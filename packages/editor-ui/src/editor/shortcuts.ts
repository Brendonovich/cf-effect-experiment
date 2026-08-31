import { Keymap } from "@opentui/keymap";
import { registerDefaultKeys, registerModBindings } from "@opentui/keymap/addons";
import { createHtmlKeymapHost, htmlEventMatchResolver } from "@opentui/keymap/html";

export type ShortcutAction =
  | "copy-nodes"
  | "cut-nodes"
  | "paste-nodes"
  | "toggle-navigation"
  | "toggle-inspector"
  | "previous-tab"
  | "next-tab"
  | "close-tab"
  | "split-horizontal"
  | "split-vertical"
  | "toggle-pins"
  | "fold-pins"
  | "expand-pins"
  | "create-node"
  | "delete-selection"
  | "cancel"
  | "toggle-pane-zoom"
  | "reset-view";

export interface ShortcutDefinition {
  readonly action: ShortcutAction;
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
}

export const editorShortcuts: ReadonlyArray<ShortcutDefinition> = [
  { action: "copy-nodes", keys: ["mod+c"], label: "Copy selected nodes" },
  { action: "cut-nodes", keys: ["mod+x"], label: "Cut selected nodes" },
  { action: "paste-nodes", keys: ["mod+v"], label: "Paste nodes at pointer or canvas center" },
  { action: "toggle-navigation", keys: ["mod+b"], label: "Toggle navigation" },
  { action: "toggle-inspector", keys: ["mod+r", "mod+i"], label: "Toggle inspector" },
  { action: "previous-tab", keys: ["mod+left"], label: "Previous tab" },
  { action: "next-tab", keys: ["mod+right"], label: "Next tab" },
  { action: "close-tab", keys: ["ctrl+w", "mod+w"], label: "Close tab" },
  { action: "split-horizontal", keys: ["mod+\\"], label: "Split horizontally" },
  { action: "split-vertical", keys: ["mod+shift+\\"], label: "Split vertically" },
  { action: "toggle-pins", keys: ["mod+e"], label: "Collapse or expand selected node pins" },
  {
    action: "fold-pins",
    keys: ["super+alt+[", "ctrl+alt+["],
    label: "Collapse selected node pins",
  },
  {
    action: "expand-pins",
    keys: ["super+alt+]", "ctrl+alt+]"],
    label: "Expand selected node pins",
  },
  { action: "create-node", keys: ["super+.", "ctrl+."], label: "Create node" },
  { action: "delete-selection", keys: ["backspace", "delete"], label: "Delete selection" },
  {
    action: "toggle-pane-zoom",
    keys: ["shift+escape", "mod+shift+escape"],
    label: "Zoom focused pane",
  },
  { action: "reset-view", keys: ["mod+0"], label: "Reset graph view" },
  { action: "cancel", keys: ["escape"], label: "Cancel or restore panes" },
];

export const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function registerEditorShortcuts(
  root: HTMLElement,
  run: (action: ShortcutAction) => boolean,
) {
  const host = createHtmlKeymapHost(root.ownerDocument.body);
  // The HTML adapter has no dispose method; its host owns the keymap's lifetime.
  let destroy = () => {};
  host.onDestroy = (listener) => {
    destroy = listener;
    return () => {
      destroy = () => {};
    };
  };
  const keymap = new Keymap(host);
  registerDefaultKeys(keymap);
  registerModBindings(keymap);
  keymap.appendEventMatchResolver(htmlEventMatchResolver);
  keymap.prependEventMatchResolver((event, context) => {
    const code = event.originalEvent?.code;
    if (!code) return;
    const punctuation: Record<string, string> = {
      Backslash: "\\",
      BracketLeft: "[",
      BracketRight: "]",
      Period: ".",
    };
    const name =
      punctuation[code] ??
      (/^(Key[A-Z]|Digit[0-9])$/.test(code)
        ? code.replace(/^(Key|Digit)/, "").toLowerCase()
        : undefined);
    if (name === undefined) return;
    // Option and Shift can change event.key (e.g. Alt+[ or Shift+Backslash).
    return [
      context.resolveKey({
        name,
        ctrl: event.ctrl,
        shift: event.shift,
        meta: event.meta,
        super: event.super ?? false,
      }),
    ];
  });
  keymap.registerLayer({
    bindings: editorShortcuts.flatMap(({ action, keys }) =>
      keys.map((key) => ({
        key,
        cmd: ({ event }) => {
          const original = event.originalEvent;
          if (
            !root.isConnected ||
            root.closest("[hidden], .hidden, [inert]") !== null ||
            root.querySelector("dialog[open][data-editor-shortcuts]") !== null ||
            original?.defaultPrevented ||
            original?.isComposing ||
            (original?.target instanceof globalThis.Node &&
              original.target !== root.ownerDocument.body &&
              !root.contains(original.target)) ||
            (action !== "cancel" && isEditableTarget(original?.target ?? null))
          )
            return false;
          return run(action);
        },
      })),
    ),
  });
  return () => destroy();
}

const formatShortcut = (key: string, apple: boolean) =>
  key
    .split("+")
    .map((part) => {
      if (part === "mod") return apple ? "⌘" : "Ctrl";
      if (part === "super") return "⌘";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+")
    .replace("⌘+", "⌘");

export const shortcutLabels = (
  action: ShortcutAction,
  apple = /Mac|iPhone|iPad/.test(navigator.platform),
) => {
  const shortcut = editorShortcuts.find((candidate) => candidate.action === action);
  if (shortcut === undefined) return [];
  return [
    ...new Set(
      shortcut.keys
        .filter((key) => apple || !key.startsWith("super+"))
        .map((key) => formatShortcut(key, apple)),
    ),
  ];
};

export const shortcutLabel = (
  action: ShortcutAction,
  apple = /Mac|iPhone|iPad/.test(navigator.platform),
) => {
  const shortcut = editorShortcuts.find((candidate) => candidate.action === action);
  if (shortcut === undefined) return "";
  const key =
    shortcut.keys.find((key) => key.startsWith(apple ? "super+" : "ctrl+")) ?? shortcut.keys[0]!;
  return formatShortcut(key, apple);
};
