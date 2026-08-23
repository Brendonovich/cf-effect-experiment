import type { Package, SchemaRef } from "@macrograph/core";

import { For, Show, createSignal, onSettled } from "solid-js";

export function NodeCreationMenu(props: {
  packages: ReadonlyArray<Package.Model>;
  screenPosition: { x: number; y: number };
  onCreate: (schema: SchemaRef, name: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = createSignal("");
  let root: HTMLDivElement | undefined;

  const packages = () => {
    const query = search().trim().toLowerCase();
    return props.packages
      .map((pkg) => ({
        ...pkg,
        schemas: pkg.schemas.filter(
          (schema) =>
            query.length === 0 ||
            schema.name.toLowerCase().includes(query) ||
            pkg.name.toLowerCase().includes(query),
        ),
      }))
      .filter((pkg) => pkg.schemas.length > 0);
  };

  onSettled(() => {
    if (!matchMedia("(pointer: coarse)").matches)
      queueMicrotask(() => root?.querySelector("input")?.focus());
    const close = (event: PointerEvent) => {
      if (!root?.contains(event.target as globalThis.Node)) props.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  });

  return (
    <div
      ref={root}
      class="fixed z-50 flex h-[min(22rem,calc(100dvh-1rem))] w-[min(18rem,calc(100vw-1rem))] flex-col overflow-hidden rounded border border-gray-5 bg-gray-3 text-sm shadow-xl"
      style={{
        left: `${Math.max(8, Math.min(innerWidth - Math.min(288, innerWidth - 16) - 8, props.screenPosition.x - 16))}px`,
        top: `${Math.max(8, Math.min(innerHeight - Math.min(352, innerHeight - 16) - 8, props.screenPosition.y - 16))}px`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        class="focus-ring rounded-t border-b border-gray-5 bg-gray-2 p-1.5 text-xs text-gray-12"
        placeholder="Search Nodes..."
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <div class="min-h-0 flex-1 overflow-y-auto p-1">
        <Show
          when={packages().length > 0}
          fallback={
            <div class="p-3 text-center text-xs italic text-gray-11">No schemas found.</div>
          }
        >
          <For each={packages()}>
            {(pkg) => (
              <section class="mb-2">
                <div class="px-1 py-1 text-[11px] font-medium text-gray-11">{pkg.name}</div>
                <For each={pkg.schemas}>
                  {(schema) => (
                    <button
                      type="button"
                      class="focus-ring flex w-full flex-row items-center gap-2 rounded bg-transparent px-1 py-0.5 text-left text-gray-12 hover:bg-gray-5 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-2"
                      onClick={() => {
                        props.onCreate({ package: pkg.id, schema: schema.id }, schema.name);
                        props.onClose();
                      }}
                    >
                      <span
                        class={`size-3 rounded-full ${
                          schema.type === "event"
                            ? "bg-red-700"
                            : schema.type === "exec"
                              ? "bg-blue-600"
                              : "bg-emerald-700"
                        }`}
                      />
                      <span>{schema.name}</span>
                    </button>
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
