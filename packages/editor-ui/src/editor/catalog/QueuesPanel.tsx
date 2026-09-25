import type { Function as GraphFunction, Queue } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { AddButton } from "../../ui/AddButton";
import { SearchInput } from "./SearchInput";

const styles = stylex.create({
  panel: {
    alignSelf: "flex-start",
    borderInline: `1px solid ${colors.gray5}`,
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    width: "100%",
    maxWidth: 960,
  },
  main: {
    display: "flex",
    flex: 1,
    flexDirection: { default: "column", "@media (min-width: 640px)": "row" },
    minHeight: 0,
    minWidth: 0,
  },
  navigation: {
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: { default: 1, "@media (min-width: 640px)": 0 },
    borderRightColor: colors.gray5,
    borderRightStyle: "solid",
    borderRightWidth: 1,
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    maxHeight: { default: 220, "@media (min-width: 640px)": "none" },
    minHeight: 0,
    width: { default: "100%", "@media (min-width: 640px)": 224 },
  },
  search: {
    alignItems: "stretch",
    backgroundColor: colors.gray2,
    borderBottomColor: colors.gray6,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexShrink: 0,
    height: 32,
    width: "100%",
  },
  queueList: { flex: 1, minHeight: 0, overflowY: "auto", paddingBlock: 4 },
  queueOption: {
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    color: colors.gray11,
    display: "block",
    fontSize: 12,
    outline: "none",
    overflow: "hidden",
    paddingBlock: 6,
    paddingInline: 10,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
    ":focus-visible": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
  },
  selectedQueue: { backgroundColor: colors.gray4, color: colors.gray12 },
  detail: { flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto" },
  detailEmpty: { display: "grid", height: "100%", placeItems: "center" },
  queueDetail: { border: 0, margin: 0, padding: 16 },
  description: { color: "var(--gray-11)", fontSize: 12, lineHeight: "18px", margin: "0 0 12px" },
  empty: { color: colors.gray9, fontSize: 12, padding: 12 },
  name: {
    width: "100%",
    minWidth: 0,
    backgroundColor: "transparent",
    border: 0,
    color: "var(--gray-12)",
    fontWeight: 600,
    fontSize: 13,
    padding: "4px 0",
  },
  status: { color: "var(--gray-11)", fontSize: 11, marginBlock: 6 },
  actions: { display: "flex", flexWrap: "wrap", gap: 6 },
  button: {
    backgroundColor: "var(--gray-3)",
    color: "var(--gray-12)",
    border: "1px solid var(--gray-6)",
    borderRadius: 4,
    padding: "4px 7px",
    fontSize: 11,
    cursor: "pointer",
    opacity: { default: 1, ":disabled": 0.4 },
  },
  items: { marginTop: 10, padding: 0, listStyle: "none" },
  item: { display: "flex", alignItems: "center", gap: 6, paddingBlock: 4, fontSize: 11 },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  error: { color: "var(--red-11)", fontSize: 12 },
});

export function QueuesPanel(props: {
  queues: Readonly<Record<string, Queue.Model>>;
  states: ReadonlyArray<Queue.State>;
  canEdit: boolean;
  error: string | null;
  functions: ReadonlyArray<GraphFunction.Model>;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onPause: (id: string, paused: boolean) => void;
  onAdvance: (id: string) => void;
  onClear: (id: string) => void;
  onRemove: (id: string, itemId: string) => void;
}) {
  const [search, setSearch] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const queues = createMemo(() =>
    Object.values(props.queues).filter((queue) =>
      queue.name.toLowerCase().includes(search().trim().toLowerCase()),
    ),
  );
  const selectedQueue = createMemo(() => {
    const values = Object.values(props.queues);
    return values.find((queue) => queue.id === selectedId()) ?? values[0];
  });
  return (
    <div sx={styles.panel} data-component="queues-panel">
      <div sx={styles.main}>
        <div sx={styles.navigation}>
          <div sx={styles.search}>
            <SearchInput value={search()} placeholder="Search queues" onChange={setSearch} />
            <AddButton
              aria-label="New queue"
              title="New queue"
              disabled={!props.canEdit}
              onClick={props.onCreate}
            />
          </div>
          <div sx={styles.queueList}>
            <For
              each={queues()}
              fallback={
                <div sx={styles.empty}>
                  {search().trim() === "" ? "No queues yet." : "No queues match your search."}
                </div>
              }
            >
              {(queue) => (
                <button
                  type="button"
                  sx={[
                    styles.queueOption,
                    selectedQueue()?.id === queue.id ? styles.selectedQueue : null,
                  ]}
                  aria-current={selectedQueue()?.id === queue.id ? "page" : undefined}
                  onClick={() => setSelectedId(queue.id)}
                >
                  {queue.name}
                </button>
              )}
            </For>
          </div>
        </div>
        <div sx={styles.detail}>
          <Show
            when={selectedQueue()}
            fallback={
              <div sx={[styles.empty, styles.detailEmpty]}>Select a queue to inspect it.</div>
            }
          >
            {(queue) => {
              const state = createMemo(() =>
                props.states.find((state) => state.queueId === queue().id),
              );
              const items = createMemo(() => [
                ...(state()?.running ?? []).map((item) => ({ ...item, status: "Running" })),
                ...(state()?.waiting ?? []).map((item) => ({ ...item, status: "Waiting" })),
              ]);
              return (
                <section sx={styles.queueDetail} aria-label={queue().name}>
                  <input
                    sx={styles.name}
                    aria-label={`Queue name ${queue().name}`}
                    value={queue().name}
                    disabled={!props.canEdit}
                    onChange={(event) => props.onRename(queue().id, event.currentTarget.value)}
                  />
                  <p sx={styles.description}>
                    Calls run FIFO, one at a time. Advance starts another call alongside running
                    work. Pause does not interrupt running calls.
                  </p>
                  <Show when={props.error}>
                    <p role="alert" sx={styles.error}>
                      {props.error}
                    </p>
                  </Show>
                  <div sx={styles.status}>
                    {state() === undefined
                      ? "Runtime unavailable"
                      : `${state()?.paused ? "Paused" : "Active"} / ${state()?.running.length ?? 0} running / ${state()?.waiting.length ?? 0} waiting`}
                  </div>
                  <div sx={styles.actions}>
                    <button
                      sx={styles.button}
                      disabled={!props.canEdit || !state()}
                      onClick={() => props.onPause(queue().id, !state()?.paused)}
                    >
                      {state()?.paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      sx={styles.button}
                      disabled={
                        !props.canEdit || !state() || state()?.paused || !state()?.waiting.length
                      }
                      onClick={() => props.onAdvance(queue().id)}
                    >
                      Advance
                    </button>
                    <button
                      sx={styles.button}
                      disabled={!props.canEdit || !items().length}
                      onClick={() => props.onClear(queue().id)}
                    >
                      Clear
                    </button>
                    <button
                      sx={styles.button}
                      disabled={!props.canEdit}
                      onClick={() => props.onDelete(queue().id)}
                    >
                      Delete
                    </button>
                  </div>
                  <ul sx={styles.items}>
                    <For each={items()}>
                      {(item) => (
                        <li sx={styles.item}>
                          <span sx={styles.label}>
                            {item.status}:{" "}
                            {props.functions.find((fn) => fn.canvas.id === item.functionId)?.canvas
                              .name ?? `Missing function (${item.functionId})`}
                          </span>
                          <button
                            sx={styles.button}
                            aria-label={`Remove ${item.status} item`}
                            disabled={!props.canEdit}
                            onClick={() => props.onRemove(queue().id, item.id)}
                          >
                            Remove
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              );
            }}
          </Show>
        </div>
      </div>
    </div>
  );
}
