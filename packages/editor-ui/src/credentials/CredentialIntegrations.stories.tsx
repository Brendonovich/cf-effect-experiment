import type { Credential } from "@macrograph/module";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { CredentialIntegrations, type CredentialProvider } from "./CredentialIntegrations";

const providers: ReadonlyArray<CredentialProvider> = [
  { id: "twitch", displayName: "Twitch" },
  { id: "discord", displayName: "Discord" },
  { id: "github", displayName: "GitHub" },
  { id: "spotify", displayName: "Spotify" },
  { id: "google", displayName: "Google" },
  { id: "patreon", displayName: "Patreon" },
  { id: "streamlabs", displayName: "Streamlabs" },
];

const credentials: ReadonlyArray<Credential.Summary> = [
  {
    provider: "twitch",
    id: "stream-account",
    displayName: "Ada Streams",
    status: "available",
    scopes: ["chat:read", "chat:edit"],
    metadata: {},
  },
  {
    provider: "discord",
    id: "community-bot",
    displayName: "Community Bot",
    status: "available",
    scopes: [],
    metadata: {},
  },
  {
    provider: "spotify",
    id: "ada-listens",
    displayName: "ada.listens",
    status: "expired",
    scopes: [],
    metadata: {},
  },
];

const account = (
  provider: string,
  id: string,
  displayName: string,
  status: Credential.Summary["status"] = "available",
): Credential.Summary => ({ provider, id, displayName, status, scopes: [], metadata: {} });

const multipleAccounts: ReadonlyArray<Credential.Summary> = [
  account("twitch", "stream-account", "Ada Streams"),
  account("twitch", "bot-account", "AdaBot"),
  account("twitch", "mod-account", "ada_mod", "expired"),
  account("discord", "community-bot", "Community Bot"),
  account("discord", "personal", "ada#0001"),
  account("spotify", "ada-listens", "ada.listens"),
];

const meta = {
  title: "Editor/Credential Integrations",
  component: CredentialIntegrations,
  parameters: { layout: "padded" },
  render: (args) => (
    <div style={{ "max-width": "760px", margin: "24px auto" }}>
      <CredentialIntegrations {...args} />
    </div>
  ),
  args: {
    providers,
    credentials,
    onConnect: () => {},
    onRemove: () => {},
    description: "Connect external accounts to use them anywhere you're logged in to MacroGraph.",
  },
} satisfies Meta<typeof CredentialIntegrations>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

export const MultipleAccounts: Story = {
  args: { credentials: multipleAccounts, defaultExpanded: ["twitch"] },
};

export const AddingAccount: Story = {
  args: {
    credentials: multipleAccounts,
    defaultExpanded: ["twitch"],
    connecting: (provider) => provider === "twitch",
  },
};

export const Connecting: Story = {
  args: { connecting: (provider) => provider === "github" },
};

export const Empty: Story = {
  args: { credentials: [] },
};
