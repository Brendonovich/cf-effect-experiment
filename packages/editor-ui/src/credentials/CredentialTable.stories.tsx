import type { Credential } from "@macrograph/plugin";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { CredentialTable } from "./CredentialTable";

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
    status: "expired",
    scopes: [],
    metadata: {},
  },
];

const meta = {
  title: "Editor/Credential Table",
  component: CredentialTable,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CredentialTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithCredentials: Story = {
  args: { credentials },
};

export const Empty: Story = {
  args: { credentials: [] },
};
