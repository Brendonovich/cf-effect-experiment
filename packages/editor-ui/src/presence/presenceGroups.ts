import type { Presence } from "@macrograph/editor";

/** One entry in the presence list: a single browser tab, or one person's agents. */
export interface PresenceGroup {
  readonly key: string;
  readonly displayName: string;
  /** Tells apart several tabs from the same account, e.g. 2 for the second tab; null otherwise. */
  readonly tabNumber: number | null;
  readonly email: string | null;
  readonly color: string;
  readonly isSelf: boolean;
  readonly canEdit: boolean;
  /** The tab, or the person's REST and MCP clients. */
  readonly clients: ReadonlyArray<Presence.Client>;
  /** The entry's REST and MCP clients, most recently active first. */
  readonly remote: ReadonlyArray<Presence.Client>;
}

/** The name a REST or MCP client goes by, such as "Claude Desktop" or an API key's name. */
export const clientName = (client: Presence.Client) =>
  client.remote?.name ?? (client.kind === "mcp" ? "MCP client" : "API client");

const ownerKey = (client: Presence.Client) =>
  client.userId === null ? `client:${client.id}` : `user:${client.userId}`;

/**
 * Lists every other browser tab as its own entry, including your own other tabs, so tabs on the
 * same account can be told apart and followed individually. Agents are not tied to a tab, so each
 * person's agents share one entry.
 */
export const groupPresence = (
  clients: ReadonlyArray<Presence.Client>,
  selfId: string | undefined,
): ReadonlyArray<PresenceGroup> => {
  const selfUserId = clients.find((client) => client.id === selfId)?.userId ?? null;
  const others = clients.filter((client) => client.id !== selfId);
  const isSelf = (client: Presence.Client) => selfUserId !== null && client.userId === selfUserId;

  // Agents may lack a display name of their own, so prefer the person's browser identity.
  const browserByOwner = new Map<string, Presence.Client>();
  for (const client of clients)
    if (client.kind === "browser" && !browserByOwner.has(ownerKey(client)))
      browserByOwner.set(ownerKey(client), client);

  // Number tabs by connection order so a tab keeps its number while others come and go.
  const tabs = others
    .filter((client) => client.kind === "browser")
    .toSorted((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  const tabCounts = new Map<string, number>();
  for (const tab of tabs) tabCounts.set(ownerKey(tab), (tabCounts.get(ownerKey(tab)) ?? 0) + 1);
  const tabIndexes = new Map<string, number>();
  const tabGroups = tabs.map((tab): PresenceGroup => {
    const owner = ownerKey(tab);
    const index = (tabIndexes.get(owner) ?? 0) + 1;
    tabIndexes.set(owner, index);
    return {
      key: `tab:${tab.id}`,
      displayName: tab.displayName,
      tabNumber: (tabCounts.get(owner) ?? 0) > 1 ? index : null,
      email: tab.email,
      color: tab.color,
      isSelf: isSelf(tab),
      canEdit: tab.canEdit,
      clients: [tab],
      remote: [],
    };
  });

  const agentsByOwner = new Map<string, Presence.Client[]>();
  for (const client of others) {
    if (client.kind === "browser") continue;
    const agents = agentsByOwner.get(ownerKey(client));
    if (agents === undefined) agentsByOwner.set(ownerKey(client), [client]);
    else agents.push(client);
  }
  const agentGroups = Array.from(agentsByOwner, ([owner, agents]): PresenceGroup => {
    const sorted = agents.toSorted((left, right) => right.lastActiveAt - left.lastActiveAt);
    const primary = browserByOwner.get(owner) ?? sorted[0]!;
    return {
      key: `agents:${owner}`,
      displayName: primary.displayName,
      tabNumber: null,
      email: primary.email ?? sorted.find((client) => client.email !== null)?.email ?? null,
      color: primary.color,
      isSelf: isSelf(primary),
      canEdit: sorted.some((client) => client.canEdit),
      clients: sorted,
      remote: sorted,
    };
  });

  return [...tabGroups, ...agentGroups].sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      Number(left.remote.length > 0) - Number(right.remote.length > 0) ||
      (left.tabNumber ?? 0) - (right.tabNumber ?? 0) ||
      left.key.localeCompare(right.key),
  );
};

/** The client to follow when an entry is chosen: its most recently active. */
export const followCandidate = (group: PresenceGroup) =>
  group.clients.toSorted((left, right) => right.lastActiveAt - left.lastActiveAt)[0];

/** An entry's name, numbered when the same account has several tabs open. */
export const groupName = (group: PresenceGroup) =>
  group.tabNumber === null ? group.displayName : `${group.displayName} (${group.tabNumber})`;
