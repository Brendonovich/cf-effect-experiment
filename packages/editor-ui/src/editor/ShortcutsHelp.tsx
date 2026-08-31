import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal, createUniqueId, untrack } from "solid-js";

import type { createEditorShortcuts } from "./createEditorShortcuts";

import { colors } from "../tokens.stylex.ts";
import { capturedShortcut, editorShortcuts, type ShortcutAction } from "./shortcuts";

const styles = stylex.create({
  button: {
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    borderRadius: 4,
    color: colors.gray12,
    fontSize: 12,
    minHeight: { default: 44, "@media (min-width: 768px)": 32 },
    paddingInline: 12,
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  pane: {
    backgroundColor: colors.gray2,
    color: colors.gray12,
    containerType: "inline-size",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "auto",
    userSelect: "text",
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.gray2,
    borderBottom: `1px solid ${colors.gray5}`,
    display: "flex",
    justifyContent: "space-between",
    paddingBlock: 8,
    paddingInline: 16,
    position: "sticky",
    top: 0,
  },
  title: { fontSize: 16, fontWeight: 600, margin: 0 },
  content: { padding: 16 },
  note: { color: colors.gray11, fontSize: 12, lineHeight: 1.6, margin: 0 },
  heading: { fontSize: 12, fontWeight: 600, marginBottom: 8, marginTop: 20 },
  list: { margin: 0 },
  row: {
    alignItems: "baseline",
    borderBottom: `1px solid ${colors.gray4}`,
    display: "grid",
    gap: 8,
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@container (min-width: 480px)": "minmax(0, 1fr) minmax(0, 1fr)",
    },
    paddingBlock: 8,
    fontSize: 12,
  },
  bindings: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: { default: "flex-start", "@container (min-width: 480px)": "flex-end" },
    margin: 0,
  },
  key: {
    backgroundColor: colors.gray3,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 4,
    fontFamily: "ui-monospace, monospace",
    fontSize: 11,
    paddingBlock: 2,
    paddingInline: 6,
    overflowWrap: "anywhere",
  },
  gesture: { color: colors.gray11, margin: 0 },
});

export function ShortcutsHelp(props: { shortcuts: ReturnType<typeof createEditorShortcuts> }) {
  const [recording, setRecording] = createSignal<ShortcutAction>();
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  const gestures = [
    ["Pan graph", "Scroll, or drag empty canvas with the middle or right mouse button"],
    ["Zoom graph", apple ? "Command or Ctrl + scroll" : "Ctrl + scroll"],
    ["Select nodes in an area", "Drag empty canvas; hold Shift to add to selection"],
    [
      "Toggle a node in selection",
      "Shift + click a node, including its name; ports and fields keep their own actions",
    ],
    [
      "Move selected nodes",
      "Drag a node header; positions snap to the grid. Hold Shift while dragging for free placement",
    ],
    ["Create node", "Right-click or long-press empty canvas"],
    ["Node actions", "Right-click a node"],
    ["Connect ports", "Drag between compatible ports; drop on empty canvas to create a node"],
    ["Disconnect a port", "Double-click the port"],
    ["Touch selection", "Drag empty canvas with one finger"],
    ["Touch pan and zoom", "Drag or pinch empty canvas with two fingers"],
    ["Move a tab to another pane", "Drag the tab to the destination pane"],
  ];

  return (
    <section
      data-editor-shortcuts
      data-recording-shortcut={recording() === undefined ? undefined : ""}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      sx={styles.pane}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof globalThis.Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setRecording(undefined);
      }}
      onKeyDown={(event) => {
        const action = untrack(recording);
        if (action === undefined) return;
        event.stopPropagation();
        if (event.key === "Tab") return;
        event.preventDefault();
        if (
          event.key === "Escape" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey
        ) {
          setRecording(undefined);
          return;
        }
        const key = capturedShortcut(event);
        if (key !== undefined && props.shortcuts.replace(action, key)) setRecording(undefined);
      }}
    >
      <header sx={styles.header}>
        <h2 id={titleId} sx={styles.title}>
          Keyboard shortcuts
        </h2>
      </header>
      <div sx={styles.content}>
        <p id={descriptionId} sx={styles.note}>
          Shortcuts apply to the focused editor pane, not while typing in a field. Editing actions
          require edit access. Pane splitting is desktop-only. Changes are saved in this browser on
          this device, not in the project or account.
        </p>
        <h3 sx={styles.heading}>{apple ? "Mac / iPad keyboard" : "Windows / Linux keyboard"}</h3>
        <p sx={styles.note}>
          {apple ? "Command is shown as \u2318. " : ""}
          Each key combination is an alternative. Some browser shortcuts may be reserved. Change
          replaces all alternatives for an action. Conflicts are rejected, not reassigned.
        </p>
        <button
          type="button"
          sx={styles.button}
          onClick={() => {
            setRecording(undefined);
            props.shortcuts.reset();
          }}
        >
          Reset all to defaults
        </button>
        <p role="status" aria-live="polite" sx={styles.note}>
          {props.shortcuts.message()}
        </p>
        <dl sx={styles.list}>
          <For each={editorShortcuts}>
            {(shortcut) => (
              <div sx={styles.row} data-shortcut-action={shortcut.action}>
                <dt>{shortcut.label}</dt>
                <dd sx={styles.bindings}>
                  <For each={props.shortcuts.labels(shortcut.action, apple)}>
                    {(label) => <kbd sx={styles.key}>{label}</kbd>}
                  </For>
                  <Show when={recording() === shortcut.action}>
                    <span sx={styles.note}>Press a shortcut; Escape cancels. Tab moves focus.</span>
                  </Show>
                  <button
                    type="button"
                    sx={styles.button}
                    aria-label={`Change ${shortcut.label}`}
                    aria-pressed={recording() === shortcut.action ? "true" : "false"}
                    onClick={() =>
                      setRecording((current) =>
                        current === shortcut.action ? undefined : shortcut.action,
                      )
                    }
                  >
                    {recording() === shortcut.action ? "Cancel" : "Change"}
                  </button>
                  <Show when={props.shortcuts.overrides()[shortcut.action] !== undefined}>
                    <button
                      type="button"
                      sx={styles.button}
                      aria-label={`Reset ${shortcut.label}`}
                      onClick={() => {
                        setRecording(undefined);
                        props.shortcuts.reset(shortcut.action);
                      }}
                    >
                      Reset
                    </button>
                  </Show>
                </dd>
              </div>
            )}
          </For>
        </dl>
        <h3 sx={styles.heading}>Mouse, trackpad and touch</h3>
        <dl sx={styles.list}>
          <For each={gestures}>
            {(gesture) => (
              <div sx={styles.row}>
                <dt>{gesture[0]}</dt>
                <dd sx={styles.gesture}>{gesture[1]}</dd>
              </div>
            )}
          </For>
        </dl>
      </div>
    </section>
  );
}
