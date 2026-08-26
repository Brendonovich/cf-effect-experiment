import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { For } from "solid-js";

import { GraphNode } from "./GraphNode";
import {
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
  graphPortOffset,
} from "./graphPresentation";
import {
  branchNode,
  branchSchema,
  chatMessageNode,
  chatMessageSchema,
  containsNode,
  containsSchema,
  noop,
  noSuggestions,
  switchSceneNode,
  switchSceneSchema,
} from "../storybook-fixtures";

const meta: Meta<typeof GraphNode> = {
  title: "Editor/Graph/GraphNode",
  component: GraphNode,
  args: {
    node: { ...chatMessageNode, position: { x: 24, y: 24 } },
    schema: chatMessageSchema,
    io: chatMessageNode.io,
    onSelect: noop,
    onDragStart: noop,
    onPortPointerDown: noop,
    onDisconnect: noop,
    onContextMenu: noop,
    onExpand: noop,
    connectedInputIds: new Set<string>(),
    connectedOutputIds: new Set<string>(),
    onSetInputDefault: noop,
    onClearInputDefault: noop,
    onGetSuggestions: noSuggestions,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "min(100%, 1100px)" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof GraphNode>;

export const NodeTypes: Story = {
  play: async ({ canvasElement }) => {
    const nodes = [chatMessageNode, switchSceneNode, containsNode, branchNode];
    const pins = canvasElement.querySelectorAll<HTMLElement>("[data-io-id]");
    if (pins.length === 0) throw new Error("Expected rendered pins");
    for (const scale of [0.5, 1, 1.5, 2]) {
      canvasElement.style.transformOrigin = "top left";
      canvasElement.style.transform = `scale(${scale})`;
      try {
        for (const pin of pins) {
          const node = nodes.find((node) => node.id === pin.dataset.nodeId)!;
          const direction = pin.dataset.ioDirection === "input" ? "input" : "output";
          const ports =
            direction === "input" ? graphNodeInputs(node.io) : graphNodeOutputs(node.io);
          const index = ports.findIndex(
            (port) => port.id === pin.dataset.ioId && port.kind === pin.dataset.ioKind,
          );
          const expected = graphPortOffset(graphNodeWidth(node.io, node.name), direction, index);
          const bounds = pin.getBoundingClientRect();
          const nodeBounds = pin
            .closest<HTMLElement>("[style*='translate']")!
            .getBoundingClientRect();
          const x = (bounds.x + bounds.width / 2 - nodeBounds.x) / scale;
          const y = (bounds.y + bounds.height / 2 - nodeBounds.y) / scale;
          if (Math.abs(x - expected.x) > 0.1 || Math.abs(y - expected.y) > 0.1)
            throw new Error(
              `Pin ${node.id}/${direction}/${pin.dataset.ioId} at zoom ${scale}: expected (${expected.x}, ${expected.y}), rendered (${x}, ${y})`,
            );
        }
      } finally {
        canvasElement.style.removeProperty("transform");
        canvasElement.style.removeProperty("transform-origin");
      }
    }
  },
  render: (args) => (
    <div class="storybook-showcase">
      <For
        each={[
          { label: "Event", node: chatMessageNode, schema: chatMessageSchema },
          { label: "Execution", node: switchSceneNode, schema: switchSceneSchema },
          { label: "Pure", node: containsNode, schema: containsSchema },
          { label: "Branch", node: branchNode, schema: branchSchema },
        ]}
      >
        {(variant) => (
          <section class="storybook-showcase__node">
            <span class="storybook-showcase__label">{variant.label}</span>
            <GraphNode
              {...args}
              node={{ ...variant.node, position: { x: 0, y: 32 } }}
              schema={variant.schema}
              io={variant.node.io}
            />
          </section>
        )}
      </For>
    </div>
  ),
};

export const SelectionStates: Story = {
  render: (args) => (
    <div class="storybook-showcase">
      <For
        each={[
          { label: "Default", selected: false, presenceColor: undefined },
          { label: "Selected", selected: true, presenceColor: undefined },
          { label: "Selected by collaborator", selected: false, presenceColor: "#a855f7" },
          { label: "Both selected", selected: true, presenceColor: "#a855f7" },
        ]}
      >
        {(variant) => (
          <section class="storybook-showcase__node">
            <span class="storybook-showcase__label">{variant.label}</span>
            <GraphNode
              {...args}
              node={{ ...chatMessageNode, position: { x: 0, y: 32 } }}
              selected={variant.selected}
              presenceColor={variant.presenceColor}
            />
          </section>
        )}
      </For>
    </div>
  ),
};

export const PortStates: Story = {
  render: (args) => (
    <div class="storybook-showcase">
      <section class="storybook-showcase__node">
        <span class="storybook-showcase__label">Connected ports</span>
        <GraphNode
          {...args}
          node={{ ...branchNode, position: { x: 0, y: 32 } }}
          schema={branchSchema}
          io={branchNode.io}
          connectedInputIds={new Set(["exec", "condition"])}
          connectedOutputIds={new Set(["true"])}
        />
      </section>
      <section class="storybook-showcase__node">
        <span class="storybook-showcase__label">Folded ports</span>
        <GraphNode
          {...args}
          node={{ ...chatMessageNode, position: { x: 0, y: 32 }, foldPins: true }}
          connectedOutputIds={new Set(["triggered", "message"])}
        />
      </section>
    </div>
  ),
};
