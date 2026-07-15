import { Popover } from "@kobalte/core";
import { createMutation } from "@tanstack/solid-query";
import { createSignal, type Component } from "solid-js";

interface CreateGraphPopoverProps {
  client: any;
}

export const CreateGraphPopover: Component<CreateGraphPopoverProps> = (props) => {
  const [name, setName] = createSignal("");
  const [open, setOpen] = createSignal(false);

  const mutation = createMutation(() => ({
    mutationFn: async (input: { name: string }) => {
      const { Effect } = await import("effect");
      return await Effect.runPromise(props.client.CreateGraph({ graph: { name: input.name } }));
    },
  }));

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    mutation.mutate(
      { name: name() },
      {
        onSuccess: () => {
          setName("");
          setOpen(false);
        },
      },
    );
  };

  return (
    <Popover.Root open={open()} onOpenChange={setOpen}>
      <Popover.Trigger
        as="button"
        class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
      >
        Create Graph
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-64">
          <Popover.Arrow class="fill-white" />
          <form onSubmit={handleSubmit} class="space-y-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Graph Name</label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                placeholder="My Graph"
              />
            </div>
            <div class="flex items-center justify-between">
              <Popover.CloseButton
                as="button"
                type="button"
                class="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </Popover.CloseButton>
              <button
                type="submit"
                disabled={!name().trim() || mutation.isPending}
                class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors"
              >
                {mutation.isPending ? "Creating..." : "Create"}
              </button>
            </div>
            {mutation.isError && (
              <div class="text-xs text-red-600">
                {mutation.error?.message ?? "Failed to create graph"}
              </div>
            )}
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
