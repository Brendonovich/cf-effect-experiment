import type { Queue } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";

const styles = stylex.create({
  panel: { padding: 12 },
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
  search: string;
  canEdit: boolean;
  error: string | null;
  functionName: (id: string) => string;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onPause: (id: string, paused: boolean) => void;
  onAdvance: (id: string) => void;
  onClear: (id: string) => void;
  onRemove: (id: string, itemId: string) => void;
}) {
  const queues = createMemo(() =>
    Object.values(props.queues).filter((queue) =>
      queue.name.toLowerCase().includes(props.search.toLowerCase()),
    ),
  );
  return (
    <div sx={styles.panel} data-component="queues-panel">
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
            No queues found. Create a queue, then use Add to Queue in a graph.
          </p>
        }
      >
        {(queue) => {
          const [draftName, setDraftName] = createSignal<string | null>(null);
          const state = createMemo(() => props.states.find((state) => state.queueId === queue.id));
          const items = createMemo(() => [
            ...(state()?.running ?? []).map((item) => ({ ...item, status: "Running" })),
            ...(state()?.waiting ?? []).map((item) => ({ ...item, status: "Waiting" })),
          ]);
          return (
            <section sx={styles.queue} aria-label={queue.name}>
              <input
                sx={styles.name}
                aria-label={`Queue name ${queue.name}`}
                value={draftName() ?? queue.name}
                disabled={!props.canEdit}
                onInput={(event) => setDraftName(event.currentTarget.value)}
                onBlur={(event) => {
                  props.onRename(queue.id, event.currentTarget.value);
                  setDraftName(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    event.currentTarget.value = queue.name;
                    setDraftName(null);
                    event.currentTarget.blur();
                  }
                }}
              />
              <div sx={styles.status}>
                {state() === undefined
                  ? "Runtime unavailable"
                  : `${state()?.paused ? "Paused" : "Active"} / ${state()?.running.length ?? 0} running / ${state()?.waiting.length ?? 0} waiting`}
              </div>
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
                      <span sx={styles.label}>
                        {item.status}: {props.functionName(item.functionId)}
                      </span>
                      <button
                        sx={styles.button}
                        aria-label={`Remove ${props.functionName(item.functionId)}`}
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
  );
}
