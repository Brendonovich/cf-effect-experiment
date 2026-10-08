import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";

import type { EditorFollow } from "../editor/session/createEditorFollow";

import { clientName } from "./presenceGroups.ts";

/** Frames the workspace in the followed client's colour and offers a way to stop following. */
export function FollowIndicator(props: { readonly follow: EditorFollow }) {
  return (
    <>
      <Show when={props.follow.followed()}>
        {(client) => (
          <>
            <div
              sx={styles.frame}
              style={{ "--follow-color": client().color }}
              aria-hidden="true"
            />
            <div
              sx={styles.banner}
              style={{ "--follow-color": client().color }}
              role="status"
              data-follow-indicator=""
            >
              <span>
                Following{" "}
                {client().kind === "browser"
                  ? client().displayName
                  : `${clientName(client())} (${client().displayName})`}
                <Show when={client().kind === "browser" && client().activeGraph === null}>
                  <span sx={styles.hint}> · not viewing a graph</span>
                </Show>
                <Show when={client().kind !== "browser" && client().activeGraph === null}>
                  <span sx={styles.hint}> · waiting for an edit</span>
                </Show>
              </span>
              <button
                type="button"
                sx={styles.stop}
                title="Stop following (Esc)"
                aria-label="Stop following"
                onClick={() => props.follow.stop()}
              >
                <IconTablerX {...stylex.attrs(styles.stopIcon)} />
              </button>
            </div>
          </>
        )}
      </Show>
      <Show when={props.follow.followed() === undefined ? props.follow.notice() : null}>
        {(notice) => (
          <div sx={styles.banner} style={{ "--follow-color": notice().color }} role="status">
            <span>
              {notice().name} {notice().message}
            </span>
            <button
              type="button"
              sx={styles.stop}
              aria-label="Dismiss"
              onClick={() => props.follow.dismissNotice()}
            >
              <IconTablerX {...stylex.attrs(styles.stopIcon)} />
            </button>
          </div>
        )}
      </Show>
    </>
  );
}

const styles = stylex.create({
  frame: {
    pointerEvents: "none",
    position: "absolute",
    inset: 0,
    zIndex: 30,
    borderColor: "var(--follow-color)",
    borderStyle: "solid",
    borderWidth: 2,
  },
  banner: {
    position: "absolute",
    top: 8,
    left: "50%",
    zIndex: 31,
    display: "flex",
    alignItems: "center",
    gap: 8,
    transform: "translateX(-50%)",
    borderRadius: 9999,
    backgroundColor: "var(--follow-color)",
    paddingBlock: 3,
    paddingInlineStart: 12,
    paddingInlineEnd: 4,
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.35)",
    fontSize: 12,
    fontWeight: 600,
    color: "white",
    textShadow: "0 1px 1px rgb(0 0 0 / 0.35)",
    whiteSpace: "nowrap",
  },
  hint: { fontWeight: 400, opacity: 0.85 },
  stop: {
    display: "grid",
    width: 22,
    height: 22,
    placeItems: "center",
    border: 0,
    borderRadius: 9999,
    backgroundColor: { default: "rgb(0 0 0 / 0.25)", ":hover": "rgb(0 0 0 / 0.45)" },
    color: "white",
    cursor: "pointer",
  },
  stopIcon: { width: 14, height: 14 },
});
