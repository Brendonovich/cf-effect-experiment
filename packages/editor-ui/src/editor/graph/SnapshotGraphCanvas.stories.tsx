import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { GraphId } from "@macrograph/core";

import { SnapshotGraphCanvas } from "./SnapshotGraphCanvas";
import {
  chatMessageNode,
  chatMessageSchema,
  graph,
  renderedGraph,
  twitchPackageId,
} from "../storybook-fixtures";

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
      id: GraphId.make("single-event"),
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
      id: GraphId.make("empty-graph"),
      name: "Empty Graph",
      nodes: {},
      connections: [],
      schemas: {},
    },
  },
};
