import type { RuntimeActivity } from "@macrograph/execution";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Effect } from "effect";

import { LiveEvents } from "./LiveEvents";

const now = Date.now();
const event: RuntimeActivity.Event = {
  id: "event-13",
  pluginId: "obs",
  name: "CurrentProgramSceneChanged",
  source: "Engine",
  replayable: true,
  startedAt: now - 3000,
  finishedAt: now - 2980,
  status: "complete",
  payload: JSON.stringify({ _tag: "CurrentProgramSceneChanged", sceneName: "Gameplay" }, null, 2),
  error: null,
  nodes: [
    {
      id: "step-1",
      graphId: "stream-controls",
      nodeId: "scene-changed",
      executionId: "execution-1",
      startedAt: now - 3000,
      finishedAt: now - 2980,
      status: "complete",
      error: null,
    },
  ],
};

const meta: Meta<typeof LiveEvents> = {
  title: "Runtime/Events",
  component: LiveEvents,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    events: [],
    packages: [
      { id: "obs", name: "OBS" },
      { id: "twitch", name: "Twitch" },
    ],
    state: "live",
    error: "",
    onRetry: () => {},
    onReplay: () => Effect.void,
  },
};
export default meta;
type Story = StoryObj<typeof LiveEvents>;

export const Empty: Story = {};
export const Connecting: Story = { args: { state: "connecting" } };
export const NoExecutions: Story = { args: { events: [{ ...event, nodes: [] }] } };
export const Running: Story = {
  args: { events: [{ ...event, status: "running", finishedAt: null, nodes: [] }] },
};
export const RecentActivity: Story = {
  args: {
    events: [
      event,
      {
        ...event,
        id: "event-12",
        pluginId: "twitch",
        name: "ChannelChatMessage",
        status: "failed",
        error: "NodeExecutionError: The WebSocket connection is closed",
        payload: JSON.stringify(
          { _tag: "ChannelChatMessage", message: "!scene gameplay" },
          null,
          2,
        ),
        nodes: event.nodes.map((node) => ({
          ...node,
          status: "failed",
          error: "The WebSocket connection is closed",
        })),
      },
    ],
  },
};
export const AccessDenied: Story = {
  args: {
    state: "error",
    error: "Sign in as the server owner or an administrator to view runtime events.",
  },
};
