import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { CanvasId } from "@macrograph/core";

import {
  chatMessageNode,
  chatMessageSchema,
  graph,
  renderedGraph,
  twitchPackageId,
} from "../storybook-fixtures";
import { SnapshotGraphCanvas } from "./SnapshotGraphCanvas";

const meta: Meta<typeof SnapshotGraphCanvas> = {
  title: "Editor/Graph/SnapshotGraphCanvas",
  component: SnapshotGraphCanvas,
  args: { graph: renderedGraph },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", height: "640px", "min-width": "320px", width: "100%" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SnapshotGraphCanvas>;

export const ConnectedAutomation: Story = {};

export const SingleEvent: Story = {
  args: {
    graph: {
      id: CanvasId.make("single-event"),
      name: "Single Event",
      nodes: { [chatMessageNode.id]: chatMessageNode },
      connections: [],
      schemas: { [twitchPackageId]: { [chatMessageSchema.id]: chatMessageSchema } },
    },
  },
};

export const LegacyGraph: Story = { args: { graph } };

export const Empty: Story = {
  args: {
    graph: {
      id: CanvasId.make("empty-graph"),
      name: "Empty Graph",
      nodes: {},
      connections: [],
      schemas: {},
    },
  },
};
