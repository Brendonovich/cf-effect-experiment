import { Actor } from "@macrograph/core";
import {
  Clock,
  Context,
  Duration,
  Effect,
  FiberHandle,
  Layer,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect";

import { EditorAccess } from "./EditorAccess.ts";

export const Cursor = Schema.Struct({ x: Schema.Number, y: Schema.Number });
export type Cursor = typeof Cursor.Type;

/** The graph-space rectangle a client can currently see. */
export const Viewport = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type Viewport = typeof Viewport.Type;

/** How a REST or MCP client identifies itself, e.g. "Claude Desktop" over MCP or a named API key. */
export const RemoteLabel = Schema.Struct({
  /** The MCP client's name, otherwise the API key's name. */
  name: Schema.String,
  /** The MCP client's version, if it reported one. */
  version: Schema.NullOr(Schema.String),
  /** The API key the client authenticated with. */
  apiKeyName: Schema.NullOr(Schema.String),
});
export type RemoteLabel = typeof RemoteLabel.Type;

export const Client = Schema.Struct({
  /** The actor ID: a browser connection, API caller, or MCP session. */
  id: Schema.String,
  kind: Actor.ClientKind,
  /** Shared by every client of the same user, so they can be grouped and colored alike. */
  userId: Schema.NullOr(Schema.String),
  displayName: Schema.String,
  email: Schema.NullOr(Schema.String),
  color: Schema.String,
  canEdit: Schema.Boolean,
  activeGraph: Schema.NullOr(Schema.String),
  cursor: Schema.NullOr(Cursor),
  viewport: Schema.NullOr(Viewport),
  selectedNodeIds: Schema.Array(Schema.String),
  /** Present for REST and MCP clients. */
  remote: Schema.NullOr(RemoteLabel),
  /** Epoch milliseconds of the client's latest presence update or touch. */
  lastActiveAt: Schema.Number,
  /** Epoch milliseconds when a touched entry disappears; `null` while a live stream holds it. */
  expiresAt: Schema.NullOr(Schema.Number),
});
export type Client = typeof Client.Type;

export const Snapshot = Schema.TaggedStruct("PresenceSnapshot", {
  selfId: Schema.String,
  clients: Schema.Array(Client),
});
export type Snapshot = typeof Snapshot.Type;

export const Changed = Schema.TaggedStruct("PresenceChanged", {
  clients: Schema.Array(Client),
});
export type Changed = typeof Changed.Type;

export const Update = Schema.Struct({
  activeGraph: Schema.NullOr(Schema.String),
  cursor: Schema.NullOr(Cursor),
  viewport: Schema.NullOr(Viewport),
  selectedNodeIds: Schema.Array(Schema.String),
});
export type Update = typeof Update.Type;

/** Activity reported by a client without a live presence stream, such as an API or MCP caller. */
export interface Activity {
  /** The graph being worked on; omit to keep the previous one, such as for project-wide reads. */
  readonly activeGraph?: string | null;
  /**
   * The graph-space location of the activity, such as the latest created node. Omit to keep the
   * previous location while the active graph is unchanged.
   */
  readonly cursor?: Cursor | null;
  /** How long the entry stays visible without another touch. */
  readonly ttl?: Duration.Input;
}

export const defaultTouchTtl = Duration.minutes(2);

export class InvalidUpdate extends Schema.TaggedError<InvalidUpdate>()("InvalidPresenceUpdate", {
  reason: Schema.String,
}) {}

type RegisteredClient = Client & {
  readonly projectId: string;
  /** Kept private so touched entries can be dropped when their key is revoked. */
  readonly apiKeyId: string | null;
};

const colors = [
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
] as const;
const adjectives = ["Bright", "Calm", "Quick", "Kind", "Bold", "Quiet", "Lucky", "Swift"];
const nouns = ["Fox", "Otter", "Wren", "Koala", "Panda", "Robin", "Gecko", "Moth"];

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

export const fallbackName = (seed: string) => {
  const value = hash(seed);
  return `${adjectives[value % adjectives.length]} ${nouns[Math.floor(value / adjectives.length) % nouns.length]}`;
};

export const colorFor = (seed: string) => colors[hash(seed) % colors.length]!;

/** The local part of an email address, used as a collaborator's display name. */
export const nameFromEmail = (email: string) => email.split("@")[0]!.trim();

/** Display name and color for an identity; a user's clients share a color. */
export const appearance = (identity: EditorAccess.ConnectionIdentity) => {
  const displayName =
    identity.displayName.trim().length === 0
      ? fallbackName(identity.actor.id)
      : identity.displayName;
  return { displayName, color: colorFor(identity.actor.userId ?? displayName) };
};

/** The label shown for a REST or MCP client, or `null` for browser connections. */
export const remoteLabel = (identity: EditorAccess.ConnectionIdentity): RemoteLabel | null => {
  const remote = identity.remote;
  if (remote === undefined) return null;
  return {
    name:
      remote.mcpClientName ??
      remote.apiKeyName ??
      (identity.actor.kind === "mcp" ? "MCP client" : "API client"),
    version: remote.mcpClientName === null ? null : remote.mcpClientVersion,
    apiKeyName: remote.apiKeyName,
  };
};

const isCoordinate = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1_000_000;

const validate = (update: Update): InvalidUpdate | undefined => {
  if (update.cursor !== null && (!isCoordinate(update.cursor.x) || !isCoordinate(update.cursor.y)))
    return new InvalidUpdate({ reason: "Cursor coordinates are invalid" });
  if (
    update.viewport !== null &&
    (!isCoordinate(update.viewport.x) ||
      !isCoordinate(update.viewport.y) ||
      !isCoordinate(update.viewport.width) ||
      !isCoordinate(update.viewport.height) ||
      update.viewport.width <= 0 ||
      update.viewport.height <= 0)
  )
    return new InvalidUpdate({ reason: "Viewport is invalid" });
  if (
    update.selectedNodeIds.length > 500 ||
    new Set(update.selectedNodeIds).size !== update.selectedNodeIds.length
  )
    return new InvalidUpdate({ reason: "Selection is invalid" });
  if (
    update.activeGraph === null &&
    (update.cursor !== null || update.viewport !== null || update.selectedNodeIds.length > 0)
  )
    return new InvalidUpdate({ reason: "Graph-local state requires an active graph" });
  return undefined;
};

const clientKey = (projectId: string, clientId: string) => JSON.stringify([projectId, clientId]);

const isLive = (client: Client, now: number) => client.expiresAt === null || client.expiresAt > now;

/** Tracks connected collaborators and broadcasts project-scoped presence updates. */
export class Registry extends Context.Service<
  Registry,
  {
    /** Holds the current connection's entry for as long as the surrounding scope is open. */
    readonly register: Effect.Effect<void, never, EditorAccess.Connection | Scope.Scope>;
    readonly snapshot: (projectId: string) => Effect.Effect<ReadonlyArray<Client>>;
    readonly subscribe: Effect.Effect<PubSub.Subscription<string>, never, Scope.Scope>;
    readonly graphDeleted: (projectId: string, graphId: string) => Effect.Effect<void>;
    readonly nodeDeleted: (
      projectId: string,
      graphId: string,
      nodeId: string,
    ) => Effect.Effect<void>;
    readonly update: (
      update: Update,
    ) => Effect.Effect<void, InvalidUpdate, EditorAccess.Connection>;
    /**
     * Marks a client without a live stream as active. The entry expires after `activity.ttl`
     * unless touched again; touching a stream-held entry only refreshes its activity.
     */
    readonly touch: (
      identity: EditorAccess.ConnectionIdentity,
      activity: Activity,
    ) => Effect.Effect<void, InvalidUpdate>;
    /** Removes touched entries of clients that authenticated with a revoked API key. */
    readonly apiKeyRevoked: (apiKeyId: string) => Effect.Effect<void>;
  }
>()("macrograph/PresenceRegistry") {}

export const layer = Layer.effect(Registry)(
  Effect.gen(function* () {
    const clients = yield* Ref.make<ReadonlyMap<string, RegisteredClient>>(new Map());
    const generations = new Map<string, number>();
    const changes = yield* PubSub.unbounded<string>();
    const sweeper = yield* FiberHandle.make<void>();

    const clientsFor = Effect.fnUntraced(function* (projectId: string) {
      const now = yield* Clock.currentTimeMillis;
      return Array.from((yield* Ref.get(clients)).values())
        .filter((client) => client.projectId === projectId && isLive(client, now))
        .map(({ projectId: _, apiKeyId: __, ...client }) => client)
        .sort((left, right) => left.id.localeCompare(right.id));
    });

    const publishAll = (projectIds: Iterable<string>) =>
      Effect.forEach(new Set(projectIds), (projectId) => PubSub.publish(changes, projectId), {
        discard: true,
      });

    const modifyProject = (
      projectId: string,
      change: (client: RegisteredClient) => RegisteredClient | undefined,
    ) =>
      Effect.gen(function* () {
        const changed = yield* Ref.modify(clients, (current) => {
          let changed = false;
          const next = new Map(current);
          for (const [key, client] of current) {
            if (client.projectId !== projectId) continue;
            const updated = change(client);
            if (updated === undefined) continue;
            changed = true;
            next.set(key, updated);
          }
          return [changed, changed ? next : current];
        });
        if (changed) yield* PubSub.publish(changes, projectId);
      });

    // Runs only while touched entries exist, so idle hosts are not kept awake by a timer.
    const sweep: Effect.Effect<void> = Effect.gen(function* () {
      while (true) {
        const now = yield* Clock.currentTimeMillis;
        const expiries = Array.from((yield* Ref.get(clients)).values()).flatMap((client) =>
          client.expiresAt === null ? [] : [client.expiresAt],
        );
        if (expiries.length === 0) return;
        const next = Math.min(...expiries);
        if (next > now) {
          yield* Effect.sleep(Duration.millis(next - now));
          continue;
        }
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const expired = yield* Ref.modify(clients, (current) => {
              const removed: string[] = [];
              const remaining = new Map(current);
              for (const [key, client] of current) {
                if (isLive(client, now)) continue;
                remaining.delete(key);
                removed.push(client.projectId);
              }
              return [removed, removed.length === 0 ? current : remaining];
            });
            yield* publishAll(expired);
          }),
        );
      }
    });

    return Registry.of({
      graphDeleted: (projectId, graphId) =>
        modifyProject(projectId, (client) =>
          client.activeGraph !== graphId
            ? undefined
            : { ...client, activeGraph: null, cursor: null, viewport: null, selectedNodeIds: [] },
        ),
      nodeDeleted: (projectId, graphId, nodeId) =>
        modifyProject(projectId, (client) =>
          client.activeGraph !== graphId || !client.selectedNodeIds.includes(nodeId)
            ? undefined
            : { ...client, selectedNodeIds: client.selectedNodeIds.filter((id) => id !== nodeId) },
        ),
      register: Effect.gen(function* () {
        const identity = yield* EditorAccess.Connection;
        const now = yield* Clock.currentTimeMillis;
        const key = clientKey(identity.projectId, identity.actor.id);
        const generation = (generations.get(key) ?? 0) + 1;
        generations.set(key, generation);
        const client: RegisteredClient = {
          id: identity.actor.id,
          kind: identity.actor.kind,
          userId: identity.actor.userId,
          ...appearance(identity),
          email: identity.email,
          canEdit: identity.canEdit,
          projectId: identity.projectId,
          apiKeyId: identity.remote?.apiKeyId ?? null,
          activeGraph: null,
          cursor: null,
          viewport: null,
          selectedNodeIds: [],
          remote: remoteLabel(identity),
          lastActiveAt: now,
          expiresAt: null,
        };
        yield* Ref.update(clients, (current) => new Map(current).set(key, client));
        yield* PubSub.publish(changes, identity.projectId);
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            if (generations.get(key) !== generation) return;
            generations.delete(key);
            yield* Ref.update(clients, (current) => {
              const next = new Map(current);
              next.delete(key);
              return next;
            });
            yield* PubSub.publish(changes, identity.projectId);
          }),
        );
      }),
      snapshot: clientsFor,
      subscribe: PubSub.subscribe(changes),
      update: Effect.fnUntraced(function* (update) {
        const identity = yield* EditorAccess.Connection;
        const invalid = validate(update);
        if (invalid !== undefined) return yield* invalid;
        const now = yield* Clock.currentTimeMillis;
        yield* Ref.update(clients, (current) => {
          const key = clientKey(identity.projectId, identity.actor.id);
          const existing = current.get(key);
          return existing === undefined
            ? current
            : new Map(current).set(key, { ...existing, ...update, lastActiveAt: now });
        });
        yield* PubSub.publish(changes, identity.projectId);
      }),
      touch: Effect.fnUntraced(function* (identity, activity) {
        const now = yield* Clock.currentTimeMillis;
        const expiresAt = now + Duration.toMillis(activity.ttl ?? defaultTouchTtl);
        const key = clientKey(identity.projectId, identity.actor.id);
        const existing = (yield* Ref.get(clients)).get(key);
        // A live stream owns its entry's location; touches only mark it active.
        if (existing !== undefined && existing.expiresAt === null) {
          yield* Ref.update(clients, (current) => {
            const entry = current.get(key);
            return entry === undefined
              ? current
              : new Map(current).set(key, { ...entry, lastActiveAt: now });
          });
          yield* PubSub.publish(changes, identity.projectId);
          return;
        }
        const previous = existing !== undefined && isLive(existing, now) ? existing : undefined;
        const activeGraph =
          activity.activeGraph === undefined
            ? (previous?.activeGraph ?? null)
            : activity.activeGraph;
        const cursor =
          activity.cursor !== undefined
            ? activity.cursor
            : previous !== undefined && previous.activeGraph === activeGraph
              ? previous.cursor
              : null;
        const invalid = validate({ activeGraph, cursor, viewport: null, selectedNodeIds: [] });
        if (invalid !== undefined) return yield* invalid;
        const touched: RegisteredClient = {
          id: identity.actor.id,
          kind: identity.actor.kind,
          userId: identity.actor.userId,
          ...appearance(identity),
          email: identity.email,
          canEdit: identity.canEdit,
          projectId: identity.projectId,
          apiKeyId: identity.remote?.apiKeyId ?? null,
          activeGraph,
          cursor,
          viewport: null,
          selectedNodeIds: [],
          remote: remoteLabel(identity),
          lastActiveAt: now,
          expiresAt,
        };
        yield* Ref.update(clients, (current) => {
          const entry = current.get(key);
          // A stream registered meanwhile takes precedence.
          if (entry !== undefined && entry.expiresAt === null) return current;
          return new Map(current).set(key, touched);
        });
        yield* PubSub.publish(changes, identity.projectId);
        yield* FiberHandle.run(sweeper, sweep);
      }),
      apiKeyRevoked: (apiKeyId) =>
        Effect.gen(function* () {
          const removed = yield* Ref.modify(clients, (current) => {
            const projects: string[] = [];
            const remaining = new Map(current);
            for (const [key, client] of current) {
              if (client.expiresAt === null || client.apiKeyId !== apiKeyId) continue;
              remaining.delete(key);
              projects.push(client.projectId);
            }
            return [projects, projects.length === 0 ? current : remaining];
          });
          yield* publishAll(removed);
        }),
    });
  }),
);

export const stream = Stream.unwrap(
  Effect.gen(function* () {
    const identity = yield* EditorAccess.Connection;
    const registry = yield* Registry;
    const subscription = yield* registry.subscribe;
    yield* registry.register;
    const clients = yield* registry.snapshot(identity.projectId);
    return Stream.succeed<Snapshot>({
      _tag: "PresenceSnapshot",
      selfId: identity.actor.id,
      clients,
    }).pipe(
      Stream.concat(
        Stream.fromSubscription(subscription).pipe(
          Stream.filter((projectId) => projectId === identity.projectId),
          // Flush during continuous movement instead of waiting for a pause.
          Stream.groupedWithin(100, "20 millis"),
          Stream.mapEffect(() => registry.snapshot(identity.projectId)),
          Stream.map((clients): Changed => ({ _tag: "PresenceChanged", clients })),
        ),
      ),
    );
  }),
);

export * as Presence from "./Presence.ts";
