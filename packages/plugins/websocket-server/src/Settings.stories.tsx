import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Effect } from "effect";

import { ServerId } from "./Definition";
import Settings, { type SettingsProps } from "./Settings";

const rpc = {
  WebSocketServerAdd: () => Effect.succeed(ServerId.make("server-new")),
  WebSocketServerUpdate: () => Effect.succeed(undefined),
  WebSocketServerRemove: () => Effect.succeed(undefined),
  WebSocketServerStart: () => Effect.succeed(undefined),
  WebSocketServerStop: () => Effect.succeed(undefined),
} satisfies SettingsProps["rpc"];

const meta = {
  title: "Plugins/WebSocket Server",
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
    state: () => ({ servers: [] }),
  },
};

export const Running: Story = {
  args: {
    state: () => ({
      servers: [
        {
          definition: {
            id: ServerId.make("server-overlay"),
            name: "Overlay Events",
            host: "127.0.0.1",
            port: 1890,
            manuallyDisabled: false,
          },
          status: "running",
          clientCount: 3,
        },
      ],
    }),
  },
};

export const MixedStatuses: Story = {
  args: {
    state: () => ({
      servers: [
        {
          definition: {
            id: ServerId.make("server-overlay"),
            name: "Overlay Events",
            host: "127.0.0.1",
            port: 1890,
            manuallyDisabled: false,
          },
          status: "running",
          clientCount: 3,
        },
        {
          definition: {
            id: ServerId.make("server-mobile"),
            name: "Mobile Controller",
            host: "0.0.0.0",
            port: 8080,
            manuallyDisabled: false,
          },
          status: "starting",
          clientCount: 0,
        },
        {
          definition: {
            id: ServerId.make("server-backup"),
            name: "Backup Listener",
            host: "127.0.0.1",
            port: 9090,
            manuallyDisabled: true,
          },
          status: "stopped",
          clientCount: 0,
        },
        {
          definition: {
            id: ServerId.make("server-alerts"),
            name: "Alert Events",
            host: "127.0.0.1",
            port: 3000,
            manuallyDisabled: false,
          },
          status: "error",
          clientCount: 0,
          error: "Address already in use",
        },
        {
          definition: {
            id: ServerId.make("server-remote"),
            name: "Remote Listener",
            host: "192.168.1.12",
            port: 4567,
            manuallyDisabled: false,
          },
          status: "stopped",
          clientCount: 0,
        },
      ],
    }),
  },
};
