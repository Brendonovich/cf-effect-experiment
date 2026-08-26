import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Effect } from "effect";

import { WebhookId } from "./Definition";
import Settings, { type SettingsEndpoint, type SettingsProps } from "./Settings";

const rpc = {
  KofiCreateWebhook: () => Effect.succeed(WebhookId.make("webhook-new")),
  KofiRenameWebhook: () => Effect.succeed(undefined),
  KofiRemoveWebhook: () => Effect.succeed(undefined),
} satisfies SettingsProps["rpc"];

const meta = {
  title: "Plugins/Ko-fi",
  component: Settings,
  args: {
    endpoints: [],
    rpc,
    onChanged: async () => {},
  },
} satisfies Meta<typeof Settings>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    state: () => ({ webhooks: [] }),
  },
};

const configuredEndpoints = [
  {
    id: "endpoint-donations",
    url: "https://events.macrograph.app/ingest/kofi/donations-7f3a2b",
    schema: { id: "kofi:payment", displayName: "Ko-fi Payment" },
    instanceKey: WebhookId.make("webhook-donations"),
    displayName: "Stream Donations",
  },
  {
    id: "endpoint-memberships",
    url: "https://events.macrograph.app/ingest/kofi/memberships-9c8d1e",
    schema: { id: "kofi:payment", displayName: "Ko-fi Payment" },
    instanceKey: WebhookId.make("webhook-memberships"),
    displayName: "Membership Alerts",
  },
] satisfies ReadonlyArray<SettingsEndpoint>;

export const Configured: Story = {
  args: {
    endpoints: configuredEndpoints,
    state: () => ({
      webhooks: [
        { id: WebhookId.make("webhook-donations"), name: "Stream Donations" },
        { id: WebhookId.make("webhook-memberships"), name: "Membership Alerts" },
      ],
    }),
  },
};

export const MissingEndpoint: Story = {
  args: {
    endpoints: configuredEndpoints.slice(0, 1),
    state: () => ({
      webhooks: [
        { id: WebhookId.make("webhook-donations"), name: "Stream Donations" },
        { id: WebhookId.make("webhook-pending"), name: "New Shop Orders" },
      ],
    }),
  },
};
