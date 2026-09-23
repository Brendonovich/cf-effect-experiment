import type { Function as GraphFunction, Queue } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
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
  toolbar: {
    alignItems: "center",
    borderBottom: `1px solid ${colors.gray5}`,
    display: "flex",
    flexShrink: 0,
    gap: 8,
    padding: 8,
  },
  search: { flex: 1, minWidth: 0 },
  content: { flex: 1, minHeight: 0, overflowY: "auto", padding: 12 },
  description: { color: "var(--gray-11)", fontSize: 12, lineHeight: "18px", margin: "0 0 12px" },
  queue: { border: "1px solid var(--gray-5)", borderRadius: 6, marginBottom: 12, padding: 10 },
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
  onSetFunction: (id: string, functionId: string) => void;
  onDelete: (id: string) => void;
  onPause: (id: string, paused: boolean) => void;
  onAdvance: (id: string) => void;
  onClear: (id: string) => void;
  onRemove: (id: string, itemId: string) => void;
}) {
  const [search, setSearch] = createSignal("");
  const queues = createMemo(() =>
    Object.values(props.queues).filter((queue) =>
      queue.name.toLowerCase().includes(search().trim().toLowerCase()),
    ),
  );
  return (
    <div sx={styles.panel} data-component="queues-panel">
      <div sx={styles.toolbar}>
        <div sx={styles.search}>
          <SearchInput value={search()} placeholder="Search queues" onChange={setSearch} />
        </div>
        <button
          type="button"
          sx={styles.button}
          disabled={!props.canEdit || props.functions.length === 0}
          onClick={props.onCreate}
        >
          New queue
        </button>
      </div>
      <div sx={styles.content}>
        <p sx={styles.description}>
          Calls run FIFO, one at a time. Advance starts another call alongside running work. Pause
          does not interrupt running calls.
        </p>
        <Show when={props.error}>
          <p role="alert" sx={styles.error}>
            {props.error}
          </p>
        </Show>
        <For
          each={queues()}
          fallback={
            <p sx={styles.description}>
              {search().trim() === ""
                ? "No queues found. Create a function, then create a queue."
                : "No queues match your search."}
            </p>
          }
        >
          {(queue) => {
            const state = createMemo(() =>
              props.states.find((state) => state.queueId === queue.id),
            );
            const items = createMemo(() => [
              ...(state()?.running ?? []).map((item) => ({ ...item, status: "Running" })),
              ...(state()?.waiting ?? []).map((item) => ({ ...item, status: "Waiting" })),
            ]);
            return (
              <section sx={styles.queue} aria-label={queue.name}>
                <input
                  sx={styles.name}
                  aria-label={`Queue name ${queue.name}`}
                  value={queue.name}
                  disabled={!props.canEdit}
                  onChange={(event) => props.onRename(queue.id, event.currentTarget.value)}
                />
                <div sx={styles.status}>
                  {state() === undefined
                    ? "Runtime unavailable"
                    : `${state()?.paused ? "Paused" : "Active"} / ${state()?.running.length ?? 0} running / ${state()?.waiting.length ?? 0} waiting`}
                </div>
                <select
                  aria-label={`Queue function ${queue.name}`}
                  value={queue.functionId}
                  disabled={!props.canEdit}
                  onChange={(event) => props.onSetFunction(queue.id, event.currentTarget.value)}
                >
                  <For each={props.functions}>
                    {(fn) => <option value={fn.canvas.id}>{fn.canvas.name}</option>}
                  </For>
                </select>
                <div sx={styles.actions}>
                  <button
                    sx={styles.button}
                    disabled={!props.canEdit || !state()}
                    onClick={() => props.onPause(queue.id, !state()?.paused)}
                  >
                    {state()?.paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    sx={styles.button}
                    disabled={
                      !props.canEdit || !state() || state()?.paused || !state()?.waiting.length
                    }
                    onClick={() => props.onAdvance(queue.id)}
                  >
                    Advance
                  </button>
                  <button
                    sx={styles.button}
                    disabled={!props.canEdit || !items().length}
                    onClick={() => props.onClear(queue.id)}
                  >
                    Clear
                  </button>
                  <button
                    sx={styles.button}
                    disabled={!props.canEdit}
                    onClick={() => props.onDelete(queue.id)}
                  >
                    Delete
                  </button>
                </div>
                <ul sx={styles.items}>
                  <For each={items()}>
                    {(item) => (
                      <li sx={styles.item}>
                        <span sx={styles.label}>{item.status}</span>
                        <button
                          sx={styles.button}
                          aria-label={`Remove ${item.status} item`}
                          disabled={!props.canEdit}
                          onClick={() => props.onRemove(queue.id, item.id)}
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
        </For>
      </div>
    </div>
  );
}
