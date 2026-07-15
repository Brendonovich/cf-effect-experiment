import { EditorEvent } from "@macrograph/editor";
import { For, Show, createEffect, onCleanup, type Component } from "solid-js";
import { createStore } from "solid-js/store";

interface EventLogProps {
  events: EditorEvent.EditorEvent[];
}

const MAX_EVENTS = 25;
const LIFETIME_MS = 10_000;
const FADE_MS = 300;

interface Item {
  id: number;
  event: EditorEvent.EditorEvent;
  fading: boolean;
}

export const EventLog: Component<EventLogProps> = (props) => {
  const [items, setItems] = createStore<Item[]>([]);
  let nextId = 0;
  const seen = new WeakSet<EditorEvent.EditorEvent>();
  const timers: ReturnType<typeof setTimeout>[] = [];

  const scheduleRemoval = (id: number) => {
    const fadeTimer = setTimeout(() => {
      setItems((i) => i.id === id, "fading", true);
    }, LIFETIME_MS - FADE_MS);
    const removeTimer = setTimeout(() => {
      setItems((items) => items.filter((i) => i.id !== id));
    }, LIFETIME_MS);
    timers.push(fadeTimer, removeTimer);
  };

  createEffect(() => {
    const incoming = props.events;
    for (const event of incoming) {
      if (seen.has(event)) continue;
      seen.add(event);
      const id = nextId++;
      setItems((items) => [{ id, event, fading: false }, ...items].slice(0, MAX_EVENTS));
      scheduleRemoval(id);
    }
  });

  onCleanup(() => {
    for (const t of timers) clearTimeout(t);
  });

  return (
    <Show when={items.length > 0}>
      <div class="fixed bottom-4 right-4 z-50 flex flex-col-reverse items-end gap-1 pointer-events-none">
        <For each={items}>
          {(item) => (
            <div
              class="group pointer-events-auto animate-event-in w-fit max-w-[16rem] transition-opacity duration-300"
              classList={{ "opacity-0": item.fading }}
            >
              <div class="px-2.5 py-1 rounded-full bg-white/95 shadow-md border border-gray-200 text-xs font-mono font-semibold text-gray-700 cursor-default whitespace-nowrap transition-all duration-150 group-hover:rounded-lg group-hover:shadow-lg">
                {item.event._tag}
              </div>
              <pre class="max-h-0 opacity-0 overflow-hidden group-hover:max-h-96 group-hover:opacity-100 group-hover:overflow-auto transition-all duration-200 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2.5 text-[11px] font-mono text-gray-600 whitespace-pre-wrap break-all">
                {JSON.stringify(item.event, null, 2)}
              </pre>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};
