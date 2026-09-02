import * as stylex from "@stylexjs/stylex";
import { For, createUniqueId } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { editorShortcuts, shortcutLabels } from "./shortcuts";

const styles = stylex.create({
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    flexShrink: 0,
    borderTop: `1px solid ${colors.gray5}`,
    backgroundColor: colors.gray2,
    paddingInline: 8,
  },
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
  dialog: {
    backgroundColor: colors.gray2,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 8,
    boxShadow: "0 24px 80px rgb(0 0 0 / 0.5)",
    color: colors.gray12,
    margin: "auto",
    maxHeight: "calc(100dvh - 24px)",
    maxWidth: "calc(100vw - 24px)",
    overflow: "auto",
    padding: 0,
    userSelect: "text",
    width: 600,
    "::backdrop": { backgroundColor: "rgb(0 0 0 / 0.65)" },
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
    gridTemplateColumns: { default: "1fr", "@media (min-width: 480px)": "1fr 1fr" },
    paddingBlock: 8,
    fontSize: 12,
  },
  bindings: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: { default: "flex-start", "@media (min-width: 480px)": "flex-end" },
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
    whiteSpace: "nowrap",
  },
  gesture: { color: colors.gray11, margin: 0 },
});

export function ShortcutsHelp() {
  let dialog: HTMLDialogElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  const gestures = [
    ["Pan graph", "Scroll, or drag empty canvas with the middle or right mouse button"],
    ["Zoom graph", apple ? "Command or Ctrl + scroll" : "Ctrl + scroll"],
    ["Select nodes in an area", "Drag empty canvas; hold Shift to add to selection"],
    ["Toggle a node in selection", "Shift + click the node header outside its name"],
    ["Move selected nodes", "Drag a node header"],
    ["Create node", "Right-click or long-press empty canvas"],
    ["Node actions", "Right-click a node"],
    ["Connect ports", "Drag between compatible ports; drop on empty canvas to create a node"],
    ["Disconnect a port", "Double-click the port"],
    ["Touch selection", "Drag empty canvas with one finger"],
    ["Touch pan and zoom", "Drag or pinch empty canvas with two fingers"],
    ["Move a tab to another pane", "Drag the tab to the destination pane"],
  ];

  return (
    <div sx={styles.footer}>
      <button
        ref={trigger}
        type="button"
        sx={styles.button}
        aria-haspopup="dialog"
        onClick={() => dialog?.showModal()}
      >
        Shortcuts
      </button>
      <dialog
        ref={dialog}
        data-editor-shortcuts
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        sx={styles.dialog}
        onClose={() => trigger?.focus()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header sx={styles.header}>
          <h2 id={titleId} sx={styles.title}>
            Keyboard shortcuts
          </h2>
          <button type="button" autofocus sx={styles.button} onClick={() => dialog?.close()}>
            Close
          </button>
        </header>
        <div sx={styles.content}>
          <p id={descriptionId} sx={styles.note}>
            Shortcuts apply to the focused editor pane, not while typing in a field. Editing actions
            require edit access. Pane splitting is desktop-only. This is a reference; shortcuts
            cannot be remapped yet.
          </p>
          <h3 sx={styles.heading}>{apple ? "Mac / iPad keyboard" : "Windows / Linux keyboard"}</h3>
          <p sx={styles.note}>
            {apple ? "Command is shown as \u2318. " : ""}
            Each key combination is an alternative. Some browser shortcuts may be reserved. Node
            clipboard uses the system clipboard and requires browser permission. Paste snaps the
            group's top-left anchor to the grid, preserving relative spacing. System-created nodes
            are skipped when copying or cutting. Missing schemas require confirmation and can be
            pasted without importing them. Valid external links reconnect only in the source graph;
            missing endpoints and occupied inputs are skipped.
          </p>
          <dl sx={styles.list}>
            <For each={editorShortcuts}>
              {(shortcut) => (
                <div sx={styles.row}>
                  <dt>{shortcut.label}</dt>
                  <dd sx={styles.bindings}>
                    <For each={shortcutLabels(shortcut.action, apple)}>
                      {(label) => <kbd sx={styles.key}>{label}</kbd>}
                    </For>
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
      </dialog>
    </div>
  );
}
