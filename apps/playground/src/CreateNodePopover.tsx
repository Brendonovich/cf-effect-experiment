import { Popover } from "@kobalte/core";
import { Package } from "@macrograph/core";
import { createMutation } from "@tanstack/solid-query";
import { For, Show, createSignal, type Component } from "solid-js";

interface CreateNodePopoverProps {
  client: any;
  graphId: string;
  packages: Package.Model[];
}

export const CreateNodePopover: Component<CreateNodePopoverProps> = (props) => {
  const [name, setName] = createSignal("");
  const [selectedSchema, setSelectedSchema] = createSignal<string>("");
  const [open, setOpen] = createSignal(false);

  const schemaOptions = () =>
    props.packages.flatMap((p) =>
      p.schemas.map((s) => ({
        label: `${p.name} › ${s.name}`,
        value: `${p.id}:${s.id}`,
        packageId: p.id,
        schemaId: s.id,
      })),
    );

  const mutation = createMutation(() => ({
    mutationFn: async (input: { name: string; schema: SchemaRef }) => {
      const { Effect } = await import("effect");
      return await Effect.runPromise(
        props.client.CreateNode({
          graphId: props.graphId,
          node: {
            name: input.name,
            schema: input.schema,
            position: { x: 0, y: 0 },
          },
        }),
      );
    },
  }));

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const option = schemaOptions().find((o) => o.value === selectedSchema());
    if (!option) return;

    mutation.mutate(
      {
        name: name(),
        schema: { package: option.packageId, schema: option.schemaId },
      },
      {
        onSuccess: () => {
          setName("");
          setSelectedSchema("");
          setOpen(false);
        },
      },
    );
  };

  const canSubmit = () => name().trim() && selectedSchema() && !mutation.isPending;

  return (
    <Popover.Root open={open()} onOpenChange={setOpen}>
      <Popover.Trigger
        as="button"
        class="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
      >
        Create Node
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-72">
          <Popover.Arrow class="fill-white" />
          <form onSubmit={handleSubmit} class="space-y-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Node Name</label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                placeholder="My Node"
              />
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Schema</label>
              <Show
                when={schemaOptions().length > 0}
                fallback={<div class="text-xs text-gray-400 italic">No packages loaded.</div>}
              >
                <select
                  value={selectedSchema()}
                  onChange={(e) => setSelectedSchema(e.currentTarget.value)}
                  class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white"
                >
                  <option value="">Select a schema...</option>
                  <For each={schemaOptions()}>
                    {(opt) => <option value={opt.value}>{opt.label}</option>}
                  </For>
                </select>
              </Show>
            </div>

            <div class="flex items-center justify-between pt-1">
              <Popover.CloseButton
                as="button"
                type="button"
                class="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </Popover.CloseButton>
              <button
                type="submit"
                disabled={!canSubmit()}
                class="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors"
              >
                {mutation.isPending ? "Creating..." : "Create"}
              </button>
            </div>
            {mutation.isError && (
              <div class="text-xs text-red-600">
                {mutation.error?.message ?? "Failed to create node"}
              </div>
            )}
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
