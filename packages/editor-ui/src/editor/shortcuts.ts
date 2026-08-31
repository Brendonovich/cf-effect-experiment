import { Keymap } from "@opentui/keymap";
import {
  registerBindingOverrides,
  registerDefaultKeys,
  registerModBindings,
} from "@opentui/keymap/addons";
import {
  createHtmlKeymapHost,
  htmlEventMatchResolver,
  normalizeHtmlKeyName,
} from "@opentui/keymap/html";

export type ShortcutAction =
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

export type ShortcutOverrides = Partial<Record<ShortcutAction, string>>;
export const shortcutsStorageKey = "macrograph:device-shortcuts:v1";
const punctuation: Record<string, string> = {
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Period: ".",
  Comma: ",",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
};
const physicalKey = (code: string) =>
  punctuation[code] ??
  (/^(Key[A-Z]|Digit[0-9])$/.test(code)
    ? code.replace(/^(Key|Digit)/, "").toLowerCase()
    : undefined);
const supportedKey =
  /^(?:[a-z0-9]|[\[\]\\.,/;'`=\-]|f(?:[1-9]|1[0-2])|space|return|backspace|delete|escape|up|down|left|right|home|end|pageup|pagedown|insert)$/;

export function capturedShortcut(event: KeyboardEvent): string | undefined {
  if (event.isComposing || event.repeat || event.getModifierState("AltGraph")) return;
  const name = physicalKey(event.code) ?? normalizeHtmlKeyName(event.key);
  if (!supportedKey.test(name)) return;
  return [
    event.ctrlKey && "ctrl",
    event.metaKey && "super",
    event.altKey && "alt",
    event.shiftKey && "shift",
    name,
  ]
    .filter(Boolean)
    .join("+");
}

export const shortcutKeys = (action: ShortcutAction, overrides: ShortcutOverrides = {}) =>
  overrides[action] === undefined
    ? (editorShortcuts.find((shortcut) => shortcut.action === action)?.keys ?? [])
    : [overrides[action]];

export function decodeShortcutOverrides(raw: string | null): ShortcutOverrides {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const overrides: ShortcutOverrides = {};
    for (const { action } of editorShortcuts) {
      const key = Object.getOwnPropertyDescriptor(value, action)?.value;
      if (
        typeof key === "string" &&
        supportedKey.test(key.replace(/^(?:ctrl\+)?(?:super\+)?(?:alt\+)?(?:shift\+)?/, ""))
      )
        overrides[action] = key;
    }
    return overrides;
  } catch {
    return {};
  }
}

export function registerEditorShortcuts(
  root: HTMLElement,
  run: (action: ShortcutAction) => boolean,
  overrides: ShortcutOverrides = {},
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
  registerBindingOverrides(keymap);
  keymap.appendEventMatchResolver(htmlEventMatchResolver);
  keymap.prependEventMatchResolver((event, context) => {
    const code = event.originalEvent?.code;
    if (!code) return;
    const name = physicalKey(code);
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
  root.setAttribute("data-editor-keymap", "");
  // `mod` is a binding transformer, not a parser token used by matcher queries.
  const resolvedKey = (key: string) =>
    key.replace(
      /^mod\+/,
      `${keymap.getHostMetadata().primaryModifier === "super" ? "super" : "ctrl"}+`,
    );
  const conflict = (
    action: ShortcutAction,
    keys: readonly string[],
    current: ShortcutOverrides,
  ) => {
    const matches = keys.map((key) => keymap.createKeyMatcher(resolvedKey(key)));
    return editorShortcuts.find(
      (shortcut) =>
        shortcut.action !== action &&
        shortcutKeys(shortcut.action, current).some((key) =>
          matches.some((match) => match(keymap.parseKeySequence(resolvedKey(key))[0])),
        ),
    );
  };
  // Reject a conflicting persisted set as a whole, including collisions with defaults.
  const validate = (current: ShortcutOverrides) =>
    editorShortcuts.some(({ action }) => conflict(action, shortcutKeys(action, current), current))
      ? {}
      : current;
  let removeLayer = () => {};
  const update = (current: ShortcutOverrides) => {
    removeLayer();
    keymap.clearPendingSequence();
    const effective = validate(current);
    removeLayer = keymap.registerLayer({
      bindings: editorShortcuts.flatMap(({ action, keys }) =>
        keys.map((key) => ({ key, cmd: action })),
      ),
      bindingOverrides: editorShortcuts.flatMap(({ action }) =>
        effective[action] === undefined ? [] : [{ key: effective[action], cmd: action }],
      ),
      commands: editorShortcuts.map(({ action }) => ({
        name: action,
        run: ({ event }) => {
          const original = event.originalEvent;
          const target =
            original?.target === root.ownerDocument.body
              ? root.ownerDocument.activeElement
              : original?.target;
          if (
            !root.isConnected ||
            root.closest("[hidden], .hidden, [inert]") !== null ||
            // The host captures on body before the pane's delegated recording handler.
            (target instanceof Element && target.closest("[data-recording-shortcut]") !== null) ||
            original?.defaultPrevented ||
            original?.isComposing ||
            (original?.target instanceof globalThis.Node &&
              original.target !== root.ownerDocument.body &&
              !root.contains(original.target)) ||
            (original?.target === root.ownerDocument.body &&
              (root.ownerDocument.activeElement !== root.ownerDocument.body
                ? !root.contains(root.ownerDocument.activeElement)
                : Array.from(root.ownerDocument.querySelectorAll("[data-editor-keymap]")).filter(
                    (editor) => editor.closest("[hidden], .hidden, [inert]") === null,
                  ).length > 1)) ||
            ((action !== "cancel" || original?.key !== "Escape") &&
              isEditableTarget(original?.target ?? null))
          )
            return false;
          return run(action);
        },
      })),
    });
    return effective;
  };
  update(overrides);
  return Object.assign(
    () => {
      removeLayer();
      root.removeAttribute("data-editor-keymap");
      destroy();
    },
    { update, conflict },
  );
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
  overrides: ShortcutOverrides = {},
) => {
  const shortcut = editorShortcuts.find((candidate) => candidate.action === action);
  if (shortcut === undefined) return [];
  return [
    ...new Set(
      shortcutKeys(action, overrides)
        .filter((key) => overrides[action] !== undefined || apple || !key.startsWith("super+"))
        .map((key) => formatShortcut(key, apple)),
    ),
  ];
};

export const shortcutLabel = (
  action: ShortcutAction,
  apple = /Mac|iPhone|iPad/.test(navigator.platform),
  overrides: ShortcutOverrides = {},
) => {
  const shortcut = editorShortcuts.find((candidate) => candidate.action === action);
  if (shortcut === undefined) return "";
  const key =
    shortcutKeys(action, overrides).find((key) => key.startsWith(apple ? "super+" : "ctrl+")) ??
    shortcutKeys(action, overrides)[0]!;
  return formatShortcut(key, apple);
};
