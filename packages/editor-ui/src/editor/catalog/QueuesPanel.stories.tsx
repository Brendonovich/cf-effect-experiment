import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Queue } from "@macrograph/core";
import { createSignal } from "solid-js";

import { QueuesPanel } from "./QueuesPanel";

const meta: Meta<typeof QueuesPanel> = {
  title: "Editor/Navigation/Queues",
  component: QueuesPanel,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof QueuesPanel>;

export const Management: Story = {
  render: () => {
    const [states, setStates] = createSignal<ReadonlyArray<Queue.State>>([
      {
        queueId: "notifications",
        paused: false,
        running: [{ id: "one", functionId: "deliver" }],
        waiting: [
          { id: "two", functionId: "deliver" },
          { id: "three", functionId: "deliver" },
        ],
      },
    ]);
    const [queues, setQueues] = createSignal<Readonly<Record<string, Queue.Model>>>({
      notifications: { id: Queue.QueueId.make("notifications"), name: "Notifications" },
    });
    return (
      <div style={{ width: "min(100%, 320px)", "background-color": "var(--gray-2)" }}>
        <QueuesPanel
          queues={queues()}
          states={states()}
          search=""
          canEdit
          error={null}
          functionName={() => "Deliver notification"}
          onRename={(id, name) =>
            setQueues((queues) => ({ ...queues, [id]: { id: Queue.QueueId.make(id), name } }))
          }
          onDelete={() => {
            setQueues({});
            setStates([]);
          }}
          onPause={(_id, paused) =>
            setStates((states) => states.map((state) => ({ ...state, paused })))
          }
          onAdvance={() =>
            setStates((states) =>
              states.map((state) => ({
                ...state,
                running: [...state.running, ...state.waiting.slice(0, 1)],
                waiting: state.waiting.slice(1),
              })),
            )
          }
          onClear={() =>
            setStates((states) => states.map((state) => ({ ...state, running: [], waiting: [] })))
          }
          onRemove={(_id, itemId) =>
            setStates((states) =>
              states.map((state) => ({
                ...state,
                running: state.running.filter((item) => item.id !== itemId),
                waiting: state.waiting.filter((item) => item.id !== itemId),
              })),
            )
          }
        />
      </div>
    );
  },
};
