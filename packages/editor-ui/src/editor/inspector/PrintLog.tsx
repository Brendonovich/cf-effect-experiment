import type { RuntimeActivity } from "@macrograph/execution";

import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";

export interface PrintEntry {
  readonly id: string;
  readonly graphId: string;
  readonly nodeId: string;
  readonly timestamp: number;
  readonly level: string;
  readonly message: string;
}

/** Node logs from retained runtime activity, newest first. */
export const printEntries = (events: ReadonlyArray<RuntimeActivity.Event>) =>
  events
    .flatMap((event) =>
      event.nodes.flatMap((node) =>
        node.logs.map(
          (log, index): PrintEntry => ({
            id: `${event.id}:${node.id}:${index}`,
            graphId: node.graphId,
            nodeId: node.nodeId,
            timestamp: log.timestamp,
            level: log.level,
            message: log.message,
          }),
        ),
      ),
    )
    .sort((left, right) => right.timestamp - left.timestamp);

const time = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function PrintLog(props: {
  events: ReadonlyArray<RuntimeActivity.Event>;
  nodeName: (graphId: string, nodeId: string) => string | undefined;
  onSelectNode: (graphId: string, nodeId: string) => void;
}) {
  const entries = createMemo(() => printEntries(props.events));

  return (
    <div sx={styles.list} role="log" aria-label="Print output">
      <For
        each={entries()}
        keyed={(entry) => entry.id}
        fallback={<div sx={styles.empty}>Nothing printed yet.</div>}
      >
        {(entry) => {
          const name = () => props.nodeName(entry().graphId, entry().nodeId);
          return (
            <div sx={styles.entry} data-print-entry="">
              <div sx={styles.meta}>
                <Show
                  when={name()}
                  fallback={<span sx={[styles.nodeName, styles.deleted]}>Deleted node</span>}
                >
                  {(name) => (
                    <button
                      type="button"
                      sx={[styles.nodeName, styles.nodeLink]}
                      title="Go to node"
                      onClick={() => props.onSelectNode(entry().graphId, entry().nodeId)}
                    >
                      {name()}
                    </button>
                  )}
                </Show>
                <time sx={styles.time} datetime={new Date(entry().timestamp).toISOString()}>
                  {time.format(entry().timestamp)}
                </time>
              </div>
              <span
                sx={[
                  styles.message,
                  entry().level === "Warn" && styles.warn,
                  (entry().level === "Error" || entry().level === "Fatal") && styles.error,
                ]}
              >
                {entry().message}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" },
  empty: {
    color: colors.gray10,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 8,
    textAlign: "center",
  },
  entry: {
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingBlock: 6,
    paddingInline: 8,
  },
  meta: { alignItems: "center", display: "flex", gap: 8, minWidth: 0 },
  nodeName: {
    flex: 1,
    fontSize: 11,
    fontWeight: 500,
    minWidth: 0,
    overflow: "hidden",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  nodeLink: {
    backgroundColor: "transparent",
    borderRadius: 2,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    cursor: "pointer",
    outline: "none",
    padding: 0,
    textDecoration: { default: "none", ":hover": "underline" },
    boxShadow: { default: "none", ":focus-visible": `0 0 0 1px ${colors.focus}` },
  },
  deleted: { color: colors.gray9, fontStyle: "italic" },
  time: { color: colors.gray10, flexShrink: 0, fontSize: 10, fontVariantNumeric: "tabular-nums" },
  message: {
    color: colors.gray12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
  warn: { color: colors.focus },
  error: { color: colors.red11 },
});
