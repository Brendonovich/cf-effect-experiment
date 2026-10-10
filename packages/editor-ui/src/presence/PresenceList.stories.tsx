import type { Presence } from "@macrograph/editor";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { createSignal } from "solid-js";

import { PresenceList } from "./PresenceList";

const client = (overrides: Partial<Presence.Client> & { id: string }): Presence.Client => ({
  kind: "browser",
  userId: null,
  displayName: overrides.id,
  email: null,
  color: "#0ea5e9",
  canEdit: true,
  activeGraph: null,
  cursor: null,
  viewport: null,
  selectedNodeIds: [],
  remote: null,
  lastActiveAt: 0,
  expiresAt: null,
  ...overrides,
});

// Story clients are timed relative to when the story loads, so remote entries show live ages.
const loadedAt = Date.now();

const collaborators: ReadonlyArray<Presence.Client> = [
  client({
    id: "self",
    userId: "brendon",
    displayName: "brendon",
    email: "brendon@example.com",
    color: "#6366f1",
    activeGraph: "main",
    lastActiveAt: loadedAt,
  }),
  client({
    id: "self-second-tab",
    userId: "brendon",
    displayName: "brendon",
    email: "brendon@example.com",
    color: "#6366f1",
    activeGraph: "alerts",
    lastActiveAt: loadedAt - 5_000,
  }),
  client({
    id: "streamer-tab",
    userId: "streamer",
    displayName: "streamer",
    email: "streamer@macrograph.app",
    color: "#ec4899",
    activeGraph: "alerts",
    lastActiveAt: loadedAt - 2_000,
  }),
  client({
    id: "streamer-tab-2",
    userId: "streamer",
    displayName: "streamer",
    email: "streamer@macrograph.app",
    color: "#ec4899",
    activeGraph: "main",
    lastActiveAt: loadedAt - 8_000,
  }),
  client({
    id: "mcp:streamer",
    kind: "mcp",
    userId: "streamer",
    displayName: "streamer",
    email: "streamer@macrograph.app",
    color: "#ec4899",
    activeGraph: "main",
    remote: { name: "Claude Desktop", version: "0.14.2", apiKeyName: "Laptop" },
    lastActiveAt: loadedAt - 12_000,
    expiresAt: loadedAt + 78_000,
  }),
  client({
    id: "api:ci",
    kind: "api",
    userId: "ci",
    displayName: "deploy-bot",
    email: "deploy-bot@example.com",
    color: "#eab308",
    activeGraph: "alerts",
    remote: { name: "CI deploy key", version: null, apiKeyName: "CI deploy key" },
    lastActiveAt: loadedAt - 70_000,
    expiresAt: loadedAt + 20_000,
  }),
  client({
    id: "mcp:cursor",
    kind: "mcp",
    userId: "moderator",
    displayName: "moderator",
    email: "moderator@example.com",
    color: "#22c55e",
    remote: { name: "Cursor", version: "1.4.0", apiKeyName: "Editor agent" },
    lastActiveAt: loadedAt - 3_000,
    expiresAt: loadedAt + 87_000,
  }),
  client({ id: "viewer", displayName: "Quiet Moth", color: "#14b8a6", canEdit: false }),
];

function Preview(props: { readonly clients: ReadonlyArray<Presence.Client> }) {
  const [followingId, setFollowingId] = createSignal<string | null>(null);
  return (
    <div style={{ display: "flex", "justify-content": "flex-end", padding: "8px 8px 360px" }}>
      <PresenceList
        controller={{
          connection: { presenceClients: () => props.clients, selfId: () => "self" },
          follow: { followingId, follow: setFollowingId, stop: () => setFollowingId(null) },
        }}
      />
    </div>
  );
}

const meta: Meta<typeof Preview> = {
  title: "Editor/Collaboration/PresenceList",
  component: Preview,
  args: { clients: collaborators },
};

export default meta;
type Story = StoryObj<typeof Preview>;

export const Collaborators: Story = {};

/** Nothing is shown while you are the only one here. */
export const Alone: Story = { args: { clients: collaborators.slice(0, 1) } };

/** People who are only present through MCP agents and API keys, with no editor tab open. */
export const RemoteOnly: Story = {
  args: {
    clients: collaborators.filter(
      (entry) => entry.id === "self" || (entry.kind !== "browser" && entry.userId !== "streamer"),
    ),
  },
};
