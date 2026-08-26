import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Effect } from "effect";

import { ConnectionId } from "./Definition";
import Settings, { type SettingsProps } from "./Settings";

const rpc = {
  WebSocketAddConnection: () => Effect.succeed(ConnectionId.make("connection-new")),
  WebSocketUpdateConnection: () => Effect.succeed(undefined),
  WebSocketRemoveConnection: () => Effect.succeed(undefined),
  WebSocketConnect: () => Effect.succeed(undefined),
  WebSocketDisconnect: () => Effect.succeed(undefined),
} satisfies SettingsProps["rpc"];

const meta = {
  title: "Plugins/WebSocket Client",
  component: Settings,
  args: {
    rpc,
    onChanged: async () => {},
  },
} satisfies Meta<typeof Settings>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    state: () => ({ connections: [] }),
  },
};

export const Connected: Story = {
  args: {
    state: () => ({
      connections: [
        {
          definition: {
            id: ConnectionId.make("connection-stream-deck"),
            name: "Stream Deck Bridge",
            url: "ws://localhost:8080",
            connectOnStartup: true,
          },
          status: "connected",
        },
      ],
    }),
  },
};

export const MixedStatuses: Story = {
  args: {
    state: () => ({
      connections: [
        {
          definition: {
            id: ConnectionId.make("connection-stream-deck"),
            name: "Stream Deck Bridge",
            url: "ws://localhost:8080",
            connectOnStartup: true,
          },
          status: "connected",
        },
        {
          definition: {
            id: ConnectionId.make("connection-overlay"),
            name: "Overlay Events",
            url: "wss://overlay.example.com/events",
            connectOnStartup: true,
          },
          status: "connecting",
        },
        {
          definition: {
            id: ConnectionId.make("connection-chat"),
            name: "Chat Relay",
            url: "ws://192.168.1.24:9090",
            connectOnStartup: false,
          },
          status: "disconnected",
        },
        {
          definition: {
            id: ConnectionId.make("connection-alerts"),
            name: "Alert Server",
            url: "wss://alerts.example.com/socket",
            connectOnStartup: true,
          },
          status: "error",
          error: "Connection refused",
        },
      ],
    }),
  },
};
