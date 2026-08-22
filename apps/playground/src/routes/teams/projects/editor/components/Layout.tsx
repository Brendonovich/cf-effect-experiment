import type { JSX } from "@solidjs/web";

import { For, Show, type ParentProps } from "solid-js";

export function Header(props: ParentProps) {
  return <div class="z-10 flex h-9 shrink-0 flex-row items-center bg-gray-4">{props.children}</div>;
}

export const headerButtonClass =
  "focus-ring flex h-full items-center justify-center px-3 text-gray-12 hover:bg-gray-3";

export function Sidebar(
  props: ParentProps<{ side: "left" | "right"; open: boolean; onClose?: () => void }>,
) {
  return (
    <Show when={props.open}>
      <button
        type="button"
        aria-label="Close sidebar"
        class="absolute inset-0 z-10 bg-black/50 md:hidden"
        onClick={() => props.onClose?.()}
      />
      <aside
        class={`absolute inset-y-0 z-20 flex w-56 flex-col items-stretch justify-start divide-y divide-gray-5 bg-gray-3 md:static ${
          props.side === "left" ? "left-0 border-r border-gray-5" : "right-0 border-l border-gray-5"
        }`}
      >
        {props.children}
      </aside>
    </Show>
  );
}

export interface EditorTab {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export function TabLayout(props: {
  tabs: ReadonlyArray<EditorTab>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onSplit?: () => void;
  zoomed?: boolean;
  onZoom?: () => void;
  children: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 flex-1 flex-col items-stretch overflow-hidden">
      <div class="group flex flex-row bg-gray-3">
        <div class="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <ul class="flex h-8 flex-row items-stretch divide-x divide-gray-5">
            <For each={props.tabs}>
              {(tab) => {
                const selected = () => tab.id === props.selectedId;
                return (
                  <li
                    class={`group/tab relative flex flex-row border-b ${
                      selected() ? "border-b-transparent bg-gray-2" : "border-b-gray-5 bg-gray-3"
                    }`}
                  >
                    <button
                      type="button"
                      class="focus-ring flex h-full flex-row items-center text-nowrap px-4"
                      onClick={() => props.onSelect(tab.id)}
                    >
                      <span class="text-gray-12">{tab.title}</span>
                      <Show when={tab.description}>
                        <span class="ml-1 text-xs text-gray-11">{tab.description}</span>
                      </Show>
                    </button>
                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0 group-hover/tab:opacity-100 focus-within:opacity-100">
                      <span
                        class={`h-full w-6 bg-gradient-to-r from-transparent ${
                          selected() ? "to-gray-2" : "to-gray-3"
                        }`}
                      />
                      <div
                        class={`flex h-full items-center pr-1 ${
                          selected() ? "bg-gray-2" : "bg-gray-3"
                        }`}
                      >
                        <button
                          type="button"
                          aria-label={`Close ${tab.title}`}
                          class="focus-ring pointer-events-auto rounded-sm bg-transparent p-0.5 text-white hover:bg-gray-6"
                          onClick={() => props.onClose(tab.id)}
                        >
                          <IconBiX class="size-3.5 shrink-0" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }}
            </For>
            <div class="min-w-6 flex-1 border-b border-gray-5" />
          </ul>
        </div>
        <div class="flex h-full shrink-0 flex-row items-center gap-1 border-b border-l border-gray-5 px-2">
          <Show when={props.onSplit}>
            <button
              type="button"
              title="Split Pane"
              class="focus-ring flex size-5 items-center justify-center rounded-sm bg-transparent text-gray-11 opacity-0 hover:bg-gray-6 hover:text-gray-12 group-hover:opacity-100"
              onClick={() => props.onSplit?.()}
            >
              <IconPhSquareSplitHorizontal class="size-4 shrink-0" />
            </button>
          </Show>
          <Show when={props.onZoom}>
            <button
              type="button"
              title="Zoom this panel"
              class="focus-ring flex size-5 items-center justify-center rounded-sm bg-transparent text-gray-11 opacity-0 hover:bg-gray-6 hover:text-gray-12 group-hover:opacity-100"
              onClick={() => props.onZoom?.()}
            >
              <Show
                when={props.zoomed}
                fallback={<IconTablerArrowsDiagonal class="size-4 shrink-0" />}
              >
                <IconTablerArrowsDiagonalMinimize2 class="size-4 shrink-0" />
              </Show>
            </button>
          </Show>
        </div>
      </div>
      <div class="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-gray-2">
        {props.children}
      </div>
    </div>
  );
}

export function EmptyContext() {
  return (
    <div class="flex h-full w-full flex-1 p-4 text-center text-sm italic text-gray-11">
      Select an item to view its details.
    </div>
  );
}
