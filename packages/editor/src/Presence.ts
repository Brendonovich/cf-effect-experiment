import { Context, Effect, Layer, PubSub, Ref, Schema, Scope, Stream } from "effect";

import { EditorAccess } from "./EditorAccess.ts";

export const Cursor = Schema.Struct({ x: Schema.Number, y: Schema.Number });
export type Cursor = typeof Cursor.Type;

export const Client = Schema.Struct({
  connectionId: Schema.String,
  displayName: Schema.String,
  color: Schema.String,
  canEdit: Schema.Boolean,
  activeGraph: Schema.NullOr(Schema.String),
  cursor: Schema.NullOr(Cursor),
  selectedNodeIds: Schema.Array(Schema.String),
});
export type Client = typeof Client.Type;

export const Snapshot = Schema.TaggedStruct("PresenceSnapshot", {
  selfConnectionId: Schema.String,
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
  selectedNodeIds: Schema.Array(Schema.String),
});
export type Update = typeof Update.Type;

export class InvalidUpdate extends Schema.TaggedError<InvalidUpdate>()(
  "InvalidPresenceUpdate",
  { reason: Schema.String },
) {}

type RegisteredClient = Client & { readonly projectId: string };

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

export const fallbackName = (connectionId: string) => {
  const value = hash(connectionId);
  return `${adjectives[value % adjectives.length]} ${nouns[Math.floor(value / adjectives.length) % nouns.length]}`;
};

export const colorFor = (connectionId: string) => colors[hash(connectionId) % colors.length]!;

const clientKey = (projectId: string, connectionId: string) =>
  JSON.stringify([projectId, connectionId]);

/** Tracks connected collaborators and broadcasts project-scoped presence updates. */
export class Registry extends Context.Service<
  Registry,
  {
    readonly register: Effect.Effect<void, never, EditorAccess.Connection | Scope.Scope>;
    readonly snapshot: Effect.Effect<ReadonlyArray<Client>, never, EditorAccess.Connection>;
    readonly subscribe: Effect.Effect<PubSub.Subscription<string>, never, Scope.Scope>;
    readonly graphDeleted: (
      graphId: string,
    ) => Effect.Effect<void, never, EditorAccess.Connection>;
    readonly nodeDeleted: (
      graphId: string,
      nodeId: string,
    ) => Effect.Effect<void, never, EditorAccess.Connection>;
    readonly update: (
      update: Update,
    ) => Effect.Effect<void, InvalidUpdate, EditorAccess.Connection>;
  }
>()("macrograph/PresenceRegistry") {}

export const layer = Layer.effect(
  Registry,
  Effect.gen(function* () {
    const clients = yield* Ref.make<ReadonlyMap<string, RegisteredClient>>(new Map());
    const generations = new Map<string, number>();
    const changes = yield* PubSub.unbounded<string>();

    const clientsFor = Effect.fnUntraced(function* (projectId: string) {
      return Array.from((yield* Ref.get(clients)).values())
        .filter((client) => client.projectId === projectId)
        .map(({ projectId: _, ...client }) => client)
        .sort((left, right) => left.connectionId.localeCompare(right.connectionId));
    });

    return Registry.of({
      graphDeleted: Effect.fnUntraced(function* (graphId) {
        const identity = yield* EditorAccess.Connection;
        const changed = yield* Ref.modify(clients, (current) => {
          let changed = false;
          const next = new Map(current);
          for (const [key, client] of current) {
            if (client.projectId !== identity.projectId || client.activeGraph !== graphId) continue;
            changed = true;
            next.set(key, {
              ...client,
              activeGraph: null,
              cursor: null,
              selectedNodeIds: [],
            });
          }
          return [changed, changed ? next : current];
        });
        if (changed) yield* PubSub.publish(changes, identity.projectId);
      }),
      nodeDeleted: Effect.fnUntraced(function* (graphId, nodeId) {
        const identity = yield* EditorAccess.Connection;
        const changed = yield* Ref.modify(clients, (current) => {
          let changed = false;
          const next = new Map(current);
          for (const [key, client] of current) {
            if (
              client.projectId !== identity.projectId ||
              client.activeGraph !== graphId ||
              !client.selectedNodeIds.includes(nodeId)
            )
              continue;
            changed = true;
            next.set(key, {
              ...client,
              selectedNodeIds: client.selectedNodeIds.filter((id) => id !== nodeId),
            });
          }
          return [changed, changed ? next : current];
        });
        if (changed) yield* PubSub.publish(changes, identity.projectId);
      }),
      register: Effect.gen(function* () {
        const identity = yield* EditorAccess.Connection;
        const key = clientKey(identity.projectId, identity.connectionId);
        const generation = (generations.get(key) ?? 0) + 1;
        generations.set(key, generation);
        const displayName =
          identity.displayName.trim().length === 0
            ? fallbackName(identity.connectionId)
            : identity.displayName;
        const client: RegisteredClient = {
          connectionId: identity.connectionId,
          displayName,
          color: colorFor(displayName),
          canEdit: identity.canEdit,
          projectId: identity.projectId,
          activeGraph: null,
          cursor: null,
          selectedNodeIds: [],
        };
        yield* Ref.update(clients, (current) =>
          new Map(current).set(key, client),
        );
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
      snapshot: Effect.gen(function* () {
        const identity = yield* EditorAccess.Connection;
        return yield* clientsFor(identity.projectId);
      }),
      subscribe: PubSub.subscribe(changes),
      update: Effect.fnUntraced(function* (update) {
        const identity = yield* EditorAccess.Connection;
        if (
          update.cursor !== null &&
          (!Number.isFinite(update.cursor.x) ||
            !Number.isFinite(update.cursor.y) ||
            Math.abs(update.cursor.x) > 1_000_000 ||
            Math.abs(update.cursor.y) > 1_000_000)
        )
          return yield* new InvalidUpdate({ reason: "Cursor coordinates are invalid" });
        if (
          update.selectedNodeIds.length > 500 ||
          new Set(update.selectedNodeIds).size !== update.selectedNodeIds.length
        )
          return yield* new InvalidUpdate({ reason: "Selection is invalid" });
        if (
          update.activeGraph === null &&
          (update.cursor !== null || update.selectedNodeIds.length > 0)
        )
          return yield* new InvalidUpdate({ reason: "Graph-local state requires an active graph" });

        yield* Ref.update(clients, (current) => {
          const key = clientKey(identity.projectId, identity.connectionId);
          const existing = current.get(key);
          return existing === undefined
            ? current
            : new Map(current).set(key, { ...existing, ...update });
        });
        yield* PubSub.publish(changes, identity.projectId);
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
    const clients = yield* registry.snapshot;
    return Stream.succeed<Snapshot>({
      _tag: "PresenceSnapshot",
      selfConnectionId: identity.connectionId,
      clients,
    }).pipe(
      Stream.concat(
        Stream.fromSubscription(subscription).pipe(
          Stream.filter((projectId) => projectId === identity.projectId),
          // Flush during continuous movement instead of waiting for a pause.
          Stream.groupedWithin(100, "20 millis"),
          Stream.mapEffect(() => registry.snapshot),
          Stream.map((clients): Changed => ({ _tag: "PresenceChanged", clients })),
        ),
      ),
    );
  }),
);

export * as Presence from "./Presence.ts";
