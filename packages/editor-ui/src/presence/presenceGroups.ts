import type { Presence } from "@macrograph/editor";

/** One person in the presence list, with each of their tabs and agents. */
export interface PresenceGroup {
  readonly key: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly color: string;
  readonly isSelf: boolean;
  readonly canEdit: boolean;
  /** Browser tabs first, then agents. */
  readonly clients: ReadonlyArray<Presence.Client>;
  /** The person's REST and MCP clients, most recently active first. */
  readonly remote: ReadonlyArray<Presence.Client>;
}

/** The name a REST or MCP client goes by, such as "Claude Desktop" or an API key's name. */
export const clientName = (client: Presence.Client) =>
  client.remote?.name ?? (client.kind === "mcp" ? "MCP client" : "API client");

const kindOrder: Record<Presence.Client["kind"], number> = { browser: 0, api: 1, mcp: 2 };

/**
 * Groups clients by user so one person's tabs and agents show as a single entry. Clients without a
 * user are shown on their own. Your own tabs are left out, but your agents are kept so they can be
 * followed. Your agents come first, then everyone else by name.
 */
export const groupPresence = (
  clients: ReadonlyArray<Presence.Client>,
  selfId: string | undefined,
): ReadonlyArray<PresenceGroup> => {
  const selfUserId = clients.find((client) => client.id === selfId)?.userId ?? null;
  const byKey = new Map<string, Presence.Client[]>();
  for (const client of clients) {
    if (client.id === selfId) continue;
    if (selfUserId !== null && client.userId === selfUserId && client.kind === "browser") continue;
    const key = client.userId === null ? `client:${client.id}` : `user:${client.userId}`;
    const group = byKey.get(key);
    if (group === undefined) byKey.set(key, [client]);
    else group.push(client);
  }
  const groups = Array.from(byKey, ([key, members]): PresenceGroup => {
    const sorted = members.toSorted(
      (left, right) =>
        kindOrder[left.kind] - kindOrder[right.kind] ||
        right.lastActiveAt - left.lastActiveAt ||
        left.id.localeCompare(right.id),
    );
    // Agents may lack a display name of their own, so prefer the person's browser identity.
    const primary = sorted.find((client) => client.kind === "browser") ?? sorted[0]!;
    return {
      key,
      displayName: primary.displayName,
      email: sorted.find((client) => client.email !== null)?.email ?? null,
      color: primary.color,
      isSelf: selfUserId !== null && primary.userId === selfUserId,
      canEdit: sorted.some((client) => client.canEdit),
      clients: sorted,
      remote: sorted
        .filter((client) => client.kind !== "browser")
        .toSorted((left, right) => right.lastActiveAt - left.lastActiveAt),
    };
  });
  return groups.sort(
    (left, right) =>
      Number(right.isSelf) - Number(left.isSelf) ||
      left.displayName.localeCompare(right.displayName) ||
      left.key.localeCompare(right.key),
  );
};

/** The client to follow when a person is chosen: their most recently active. */
export const followCandidate = (group: PresenceGroup) =>
  group.clients.toSorted((left, right) => right.lastActiveAt - left.lastActiveAt)[0];
