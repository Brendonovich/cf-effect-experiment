import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Effect } from "effect";

import { SocketAddress } from "./Definition";
import Settings, { type SettingsProps } from "./Settings";

const rpc = {
  AddSocket: () => Effect.succeed(undefined),
  RemoveSocket: () => Effect.succeed(undefined),
  ConnectSocket: () => Effect.succeed(undefined),
} satisfies SettingsProps["rpc"];

const meta = {
  title: "Plugins/OBS",
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
    state: () => ({ sockets: [] }),
  },
};

export const Connected: Story = {
  args: {
    state: () => ({
      sockets: [
        {
          name: "Streaming PC",
          address: SocketAddress.make("ws://localhost:4455"),
          connectOnStartup: true,
          state: "connected",
        },
      ],
    }),
  },
};

export const MixedStatuses: Story = {
  args: {
    state: () => ({
      sockets: [
        {
          name: "Streaming PC",
          address: SocketAddress.make("ws://localhost:4455"),
          connectOnStartup: true,
          state: "connected",
        },
        {
          name: "Gaming PC",
          address: SocketAddress.make("ws://192.168.1.42:4455"),
          connectOnStartup: true,
          state: "connecting",
        },
        {
          name: "Backup Studio",
          address: SocketAddress.make("ws://192.168.1.43:4455"),
          connectOnStartup: false,
          state: "disconnected",
        },
        {
          name: "Remote Studio",
          address: SocketAddress.make("wss://obs.example.com:4455"),
          connectOnStartup: true,
          state: "error",
          error: "Authentication failed",
        },
      ],
    }),
  },
};
