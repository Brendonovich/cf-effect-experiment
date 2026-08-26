import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { For } from "solid-js";

import {
  chatMessageNode,
  constants,
  graph,
  noop,
  packages,
  switchSceneNode,
} from "../storybook-fixtures";
import { Inspector } from "./Inspector";

const meta: Meta<typeof Inspector> = {
  title: "Editor/Inspector/Inspector",
  component: Inspector,
  args: {
    graph,
    node: switchSceneNode,
    packages,
    constants,
    canEdit: true,
    editingGraphNameId: null,
    onEditingGraphNameChange: noop,
    onRenameGraph: noop,
    editingNodeNameId: null,
    onEditingNodeNameChange: noop,
    onRenameNode: noop,
    onSetNodeProperty: noop,
    onClearNodeProperty: noop,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Inspector>;

export const States: Story = {
  render: (args) => (
    <div class="storybook-showcase storybook-showcase--sidebars">
      <For
        each={[
          { label: "Execution node", graph, node: switchSceneNode, canEdit: true },
          { label: "Event node", graph, node: chatMessageNode, canEdit: true },
          { label: "Graph details", graph, node: null, canEdit: true },
          { label: "Read only", graph, node: switchSceneNode, canEdit: false },
          { label: "Empty", graph: null, node: null, canEdit: true },
        ]}
      >
        {(variant) => (
          <section class="storybook-showcase__item">
            <h2 class="storybook-showcase__label">{variant.label}</h2>
            <div class="storybook-showcase__frame" style={{ overflow: "visible" }}>
              <Inspector
                {...args}
                graph={variant.graph}
                node={variant.node}
                canEdit={variant.canEdit}
              />
            </div>
          </section>
        )}
      </For>
    </div>
  ),
};
