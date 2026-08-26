import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Effect } from "effect";

import { AccountId } from "./Definition";
import Settings, { type SettingsProps } from "./Settings";

const rpc = {
  ConnectEventSub: () => Effect.succeed(undefined),
  DisconnectEventSub: () => Effect.succeed(undefined),
  ToggleEventSubSubscription: () => Effect.succeed(undefined),
} satisfies SettingsProps["rpc"];

const meta = {
  title: "Plugins/Twitch",
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
    state: () => ({ transport: "webhook", accounts: [] }),
  },
};

export const Connected: Story = {
  args: {
    state: () => ({
      transport: "websocket",
      accounts: [
        {
          id: AccountId.make("274637212"),
          displayName: "MacroGraphLive",
          eventSubSocket: { state: "connected" },
          enabledSubscriptions: [
            "channel.chat.message",
            "channel.subscribe",
            "channel.subscription.gift",
            "channel.cheer",
          ],
        },
      ],
    }),
  },
};

export const MixedStatuses: Story = {
  args: {
    state: () => ({
      transport: "websocket",
      accounts: [
        {
          id: AccountId.make("274637212"),
          displayName: "MacroGraphLive",
          eventSubSocket: { state: "connected" },
          enabledSubscriptions: ["channel.chat.message", "channel.subscribe", "channel.raid"],
        },
        {
          id: AccountId.make("518039441"),
          displayName: "SpeedrunCentral",
          eventSubSocket: { state: "connecting" },
          enabledSubscriptions: ["channel.cheer", "channel.subscription.gift"],
        },
        {
          id: AccountId.make("892146735"),
          displayName: "CommunityBot",
          eventSubSocket: { state: "disconnected" },
          enabledSubscriptions: [],
        },
      ],
    }),
  },
};
