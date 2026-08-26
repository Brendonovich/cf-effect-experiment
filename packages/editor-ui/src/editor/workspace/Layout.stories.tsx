import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { For, createSignal } from "solid-js";

import { SnapshotGraphCanvas } from "../graph/SnapshotGraphCanvas";
import { noop, renderedGraph } from "../storybook-fixtures";
import { Sidebar, TabLayout } from "./Layout";

const meta: Meta<typeof TabLayout> = {
  title: "Editor/Layout/TabLayout",
  component: TabLayout,
  args: {
    tabs: [
      { id: "stream", title: "Stream Automation" },
      { id: "moderation", title: "Chat Moderation" },
      { id: "obs", title: "OBS Studio", description: "Settings" },
    ],
    selectedId: "stream",
    focused: true,
    onSelect: noop,
    onClose: noop,
    onSplit: noop,
    onZoom: noop,
    children: <SnapshotGraphCanvas graph={renderedGraph} />,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ "min-height": "540px", padding: "24px" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TabLayout>;

export const PaneStates: Story = {
  render: (args) => (
    <div class="storybook-showcase">
      <For
        each={[
          { label: "Focused", focused: true, zoomed: false },
          { label: "Unfocused", focused: false, zoomed: false },
          { label: "Zoomed", focused: true, zoomed: true },
        ]}
      >
        {(variant) => (
          <section class="storybook-showcase__item">
            <h2 class="storybook-showcase__label">{variant.label}</h2>
            <div class="storybook-showcase__frame" style={{ height: "180px" }}>
              <TabLayout {...args} focused={variant.focused} zoomed={variant.zoomed}>
                <div style={{ padding: "16px", "font-size": "12px", color: "var(--gray-11)" }}>
                  Graph canvas
                </div>
              </TabLayout>
            </div>
          </section>
        )}
      </For>
    </div>
  ),
};

export const InteractiveTabs: Story = {
  render: (args) => {
    const [selectedId, setSelectedId] = createSignal("stream");
    return (
      <div style={{ display: "flex", height: "540px", position: "relative", width: "100%" }}>
        <TabLayout {...args} selectedId={selectedId()} onSelect={setSelectedId} />
      </div>
    );
  },
};

export const Sidebars: Story = {
  render: () => (
    <div class="storybook-showcase storybook-showcase--sidebars">
      <For
        each={
          [
            { label: "Left sidebar", side: "left", content: "Graphs and plugins" },
            { label: "Right sidebar", side: "right", content: "Inspector" },
          ] as const
        }
      >
        {(variant) => (
          <section class="storybook-showcase__item">
            <h2 class="storybook-showcase__label">{variant.label}</h2>
            <div
              class="storybook-showcase__frame"
              style={{ "justify-content": variant.side === "right" ? "flex-end" : "flex-start" }}
            >
              <Sidebar side={variant.side} open>
                <div style={{ padding: "16px", "font-size": "12px" }}>{variant.content}</div>
              </Sidebar>
            </div>
          </section>
        )}
      </For>
    </div>
  ),
};
