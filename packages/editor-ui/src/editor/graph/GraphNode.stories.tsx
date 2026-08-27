import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { For, createSignal } from "solid-js";

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
import { GraphNode } from "./GraphNode";
import {
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
  graphPortOffset,
} from "./graphPresentation";

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

export const Suggestions: Story = {
  args: {
    node: { ...switchSceneNode, position: { x: 24, y: 24 } },
    schema: switchSceneSchema,
    io: switchSceneNode.io,
    onGetSuggestions: async () => [
      "Starting Soon",
      "Just Chatting",
      "Gameplay",
      "Be Right Back",
      "Stream Ending",
      "A scene with a long name that wraps instead of being truncated",
      ...Array.from({ length: 12 }, (_, index) => `Camera ${index + 1}`),
    ],
  },
  render: (args) => {
    const [inputDefaults, setInputDefaults] = createSignal(() => args.node.inputDefaults);
    return (
      <div style={{ height: "360px", width: "100%" }}>
        <GraphNode
          {...args}
          node={{ ...args.node, inputDefaults: inputDefaults() }}
          onSetInputDefault={(input, value) => {
            if (typeof value === "string")
              setInputDefaults((previous) => ({ ...previous, [input]: value }));
          }}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[aria-label="Scene"]');
    if (!input) throw new Error("Expected scene input");
    const currentValue = () => input.value;
    const document = canvasElement.ownerDocument;
    const options = () =>
      document.querySelectorAll('[role="listbox"][aria-hidden="false"] [role="option"]');
    const waitForOptions = async (count: number) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (options().length === count) return;
        await new Promise(requestAnimationFrame);
      }
      throw new Error(`Expected ${count} suggestions, received ${options().length}`);
    };
    input.focus();
    await waitForOptions(18);
    if (canvasElement.querySelector('[role="listbox"]'))
      throw new Error("Suggestions must be portaled outside the node");
    input.value = "CHAT";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForOptions(1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await new Promise(requestAnimationFrame);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitForOptions(0);
    if (currentValue() !== "Just Chatting") throw new Error("Keyboard selection did not commit");
    input.focus();
    await waitForOptions(18);
    document.querySelector<HTMLButtonElement>('[role="option"]')?.click();
    await waitForOptions(0);
    if (currentValue() !== "Starting Soon") throw new Error("Pointer selection did not commit");
    input.focus();
    input.value = "Custom scene";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForOptions(0);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    if (currentValue() !== "Custom scene" || document.activeElement === input)
      throw new Error("Free text must commit on Enter and blur");
    input.focus();
    await waitForOptions(18);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitForOptions(0);
    input.blur();
  },
};

export const SuggestionsUnavailable: Story = {
  ...Suggestions,
  args: {
    ...Suggestions.args,
    onGetSuggestions: async () => {
      throw new Error("Integration disconnected");
    },
  },
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[aria-label="Scene"]');
    if (!input) throw new Error("Expected scene input");
    input.focus();
    await new Promise(requestAnimationFrame);
    input.value = "Offline scene";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.blur();
    await new Promise(requestAnimationFrame);
    if (input.value !== "Offline scene") throw new Error("Failed suggestions must allow free text");
  },
};

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
