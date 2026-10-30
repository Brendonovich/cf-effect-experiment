import { assert, describe, it } from "@effect/vitest";
import { Actor, ResourceConstant } from "@macrograph/core";
import { Effect, Exit, Fiber, Schema, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";

import { EditorAccess, EditorEvent, EditorRpc, Presence } from "../src/index.ts";

const identity = (
  connectionId: string,
  projectId: string,
  canEdit = true,
  canManageCredentials = canEdit,
): EditorAccess.ConnectionIdentity => ({
  actor: Actor.client("browser", connectionId),
  displayName: connectionId,
  email: null,
  projectId,
  canEdit,
  canManageCredentials,
});

const userClient = (
  kind: Actor.ClientKind,
  id: string,
  userId: string,
  projectId = "project",
): EditorAccess.ConnectionIdentity => ({
  actor: Actor.client(kind, id, userId),
  displayName: kind === "browser" ? "ada" : "",
  email: "ada@example.com",
  projectId,
  canEdit: true,
  canManageCredentials: false,
});

const graphUpdate = (cursor: Presence.Cursor | null, selectedNodeIds: string[] = []) => ({
  activeGraph: "graph",
  cursor,
  viewport: null,
  selectedNodeIds,
});

const withConnection = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  value: EditorAccess.ConnectionIdentity,
) => Effect.provideService(effect, EditorAccess.Connection, value);

describe("collaboration", () => {
  it.effect("serializes actors and suppresses only a client's own events", () =>
    Effect.gen(function* () {
      const client = Actor.client("browser", "connection-a", "user-a");
      const encoded = yield* Schema.encodeUnknownEffect(Actor.Model)(client);
      assert.deepStrictEqual(yield* Schema.decodeUnknownEffect(Actor.Model)(encoded), client);

      const own: EditorEvent.NodePositionChanged = {
        _tag: "NodePositionChanged",
        actor: client,
        graphId: "graph",
        nodeId: "node",
        x: 1,
        y: 2,
      };
      const encodedEvent = yield* Schema.encodeUnknownEffect(EditorEvent.NodePositionChanged)(own);
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(EditorEvent.NodePositionChanged)(encodedEvent),
        own,
      );
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(EditorEvent.NodePositionChanged)({
          _tag: "NodePositionChanged",
          graphId: "legacy-graph",
          nodeId: "legacy-node",
          x: 3,
          y: 4,
          clientId: "legacy-client",
        }),
        {
          _tag: "NodePositionChanged",
          actor: Actor.system,
          graphId: "legacy-graph",
          nodeId: "legacy-node",
          x: 3,
          y: 4,
        },
      );
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(EditorEvent.NodeDeleted)({
          _tag: "NodeDeleted",
          graphId: "legacy-graph",
          nodeId: "legacy-node",
        }),
        {
          _tag: "NodeDeleted",
          actor: Actor.system,
          graphId: "legacy-graph",
          nodeId: "legacy-node",
          deletedConnectionIds: [],
        },
      );
      assert.isFalse(EditorRpc.isEventVisibleTo(own, client));
      // Another tab, or an agent, of the same user still receives the edit.
      assert.isTrue(
        EditorRpc.isEventVisibleTo(own, Actor.client("browser", "connection-b", "user-a")),
      );
      assert.isTrue(EditorRpc.isEventVisibleTo(own, Actor.client("mcp", "connection-a", "user-a")));
      assert.isTrue(EditorRpc.isEventVisibleTo({ ...own, actor: Actor.system }, client));
      const defaultChanged: EditorEvent.ResourceConstantDefaultChanged = {
        _tag: "ResourceConstantDefaultChanged",
        actor: client,
        constants: [
          {
            id: ResourceConstant.Id.make("default"),
            name: "Default account",
            resource: { package: "test", resource: "account" },
            isDefault: true,
          },
        ],
      };
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(EditorEvent.ResourceConstantDefaultChanged)(
          yield* Schema.encodeUnknownEffect(EditorEvent.ResourceConstantDefaultChanged)(
            defaultChanged,
          ),
        ),
        defaultChanged,
      );
      assert.isFalse(EditorRpc.isEventVisibleTo(defaultChanged, client));
      assert.isTrue(
        EditorRpc.isEventVisibleTo(defaultChanged, Actor.client("browser", "connection-b")),
      );
    }),
  );

  it.effect("denies reader mutations and permits reads and editor mutations", () =>
    Effect.gen(function* () {
      const denied = yield* Effect.exit(
        EditorRpc.authorize(identity("reader", "project", false), "CreateNode"),
      );
      assert.isTrue(Exit.isFailure(denied));
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            EditorRpc.authorize(identity("reader", "project", false), "SetDefaultResourceConstant"),
          ),
        ),
      );
      yield* EditorRpc.authorize(identity("owner", "project"), "SetDefaultResourceConstant");
      yield* EditorRpc.authorize(identity("reader", "project", false), "GetProject");
      yield* EditorRpc.authorize(identity("reader", "project", false), "UpdatePresence");
      yield* EditorRpc.authorize(identity("owner", "project"), "CreateNode");
      yield* EditorRpc.authorize(identity("member", "project"), "SetEngineState");
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            EditorRpc.authorize(identity("member", "project", true, false), "RefetchCredentials"),
          ),
        ),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            EditorRpc.authorize(identity("reader", "project", false), "FutureMutation"),
          ),
        ),
      );
    }),
  );

  it.effect("keeps identical connection IDs isolated between projects", () =>
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      const projectA = identity("shared", "project-a");
      const projectB = identity("shared", "project-b");
      const scopeA = yield* Scope.make();
      const scopeB = yield* Scope.make();
      yield* withConnection(registry.register, projectA).pipe(Scope.provide(scopeA));
      yield* withConnection(registry.register, projectB).pipe(Scope.provide(scopeB));

      yield* withConnection(
        registry.update({
          activeGraph: "graph-a",
          cursor: { x: 1, y: 2 },
          viewport: { x: 0, y: 0, width: 100, height: 50 },
          selectedNodeIds: [],
        }),
        projectA,
      );
      assert.deepStrictEqual((yield* registry.snapshot("project-a"))[0]?.cursor, {
        x: 1,
        y: 2,
      });
      assert.strictEqual((yield* registry.snapshot("project-b"))[0]?.cursor, null);

      yield* withConnection(
        registry.update({
          activeGraph: "graph-a",
          cursor: { x: 1, y: 2 },
          viewport: null,
          selectedNodeIds: ["node-a", "node-b"],
        }),
        projectA,
      );
      yield* registry.nodeDeleted("project-a", "graph-a", "node-a");
      assert.deepStrictEqual((yield* registry.snapshot("project-a"))[0]?.selectedNodeIds, [
        "node-b",
      ]);
      yield* registry.graphDeleted("project-a", "graph-a");
      assert.deepStrictEqual((yield* registry.snapshot("project-a"))[0], {
        id: "shared",
        kind: "browser",
        userId: null,
        displayName: "shared",
        email: null,
        color: Presence.colorFor("shared"),
        canEdit: true,
        activeGraph: null,
        cursor: null,
        viewport: null,
        selectedNodeIds: [],
        remote: null,
        lastActiveAt: 0,
        expiresAt: null,
      });
      assert.strictEqual((yield* registry.snapshot("project-b"))[0]?.cursor, null);

      yield* Scope.close(scopeA, Exit.void);
      assert.strictEqual((yield* registry.snapshot("project-b")).length, 1);
      yield* Scope.close(scopeB, Exit.void);
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("scopes snapshots by project and cleans up interrupted streams", () =>
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      const projectA = identity("a", "project-a");
      const projectB = identity("b", "project-b");
      const scopeA = yield* Scope.make();
      const scopeB = yield* Scope.make();
      yield* withConnection(registry.register, projectA).pipe(Scope.provide(scopeA));
      yield* withConnection(registry.register, projectB).pipe(Scope.provide(scopeB));
      assert.deepStrictEqual(
        (yield* registry.snapshot("project-a")).map((client) => client.id),
        ["a"],
      );
      assert.deepStrictEqual(
        (yield* registry.snapshot("project-b")).map((client) => client.id),
        ["b"],
      );
      yield* Scope.close(scopeA, Exit.void);
      assert.deepStrictEqual(yield* registry.snapshot("project-a"), []);
      yield* Scope.close(scopeB, Exit.void);
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("batches pointer changes while retaining the final state", () =>
    Effect.gen(function* () {
      const connection = identity("pointer", "project");
      const registry = yield* Presence.Registry;
      const fiber = yield* withConnection(
        Presence.stream.pipe(Stream.take(2), Stream.runCollect),
        connection,
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* withConnection(registry.update(graphUpdate({ x: 1, y: 1 })), connection);
      yield* withConnection(registry.update(graphUpdate({ x: 2, y: 3 })), connection);
      yield* TestClock.adjust("20 millis");
      const events = Array.from(yield* Fiber.join(fiber));
      assert.strictEqual(events.length, 2);
      const changed = events[1];
      assert.strictEqual(changed?._tag, "PresenceChanged");
      if (changed?._tag === "PresenceChanged") {
        assert.deepStrictEqual(changed.clients[0]?.cursor, { x: 2, y: 3 });
      }
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("broadcasts continuous pointer changes without waiting for movement to stop", () =>
    Effect.gen(function* () {
      const connection = identity("pointer", "project");
      const registry = yield* Presence.Registry;
      const changes: Presence.Changed[] = [];
      yield* withConnection(
        Presence.stream.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event._tag === "PresenceChanged") changes.push(event);
            }),
          ),
        ),
        connection,
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      for (let x = 0; x < 10; x++) {
        yield* withConnection(registry.update(graphUpdate({ x, y: 0 }, ["node"])), connection);
        yield* TestClock.adjust("10 millis");
        if (x % 2 === 1) {
          assert.deepStrictEqual(changes.at(-1)?.clients[0]?.cursor, { x, y: 0 });
        }
      }

      yield* withConnection(registry.update(graphUpdate(null, ["node"])), connection);
      yield* TestClock.adjust("20 millis");
      assert.strictEqual(changes.at(-1)?.clients[0]?.cursor, null);
      const count = changes.length;
      yield* TestClock.adjust("100 millis");
      assert.strictEqual(changes.length, count);
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("removes a presence registration when its stream is interrupted", () =>
    Effect.gen(function* () {
      const connection = identity("stream", "project");
      const registry = yield* Presence.Registry;
      const fiber = yield* withConnection(Presence.stream.pipe(Stream.runDrain), connection).pipe(
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      assert.strictEqual((yield* registry.snapshot("project")).length, 1);
      yield* Fiber.interrupt(fiber);
      assert.deepStrictEqual(yield* registry.snapshot("project"), []);
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("records client kinds and shares one color across a user's clients", () =>
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      const tab = userClient("browser", "tab", "user-ada");
      yield* withConnection(registry.register, tab);
      yield* registry.touch(userClient("mcp", "mcp:session", "user-ada"), {
        activeGraph: "graph",
        cursor: { x: 10, y: 20 },
      });
      const [agent, browser] = yield* registry.snapshot("project");
      assert.strictEqual(browser?.kind, "browser");
      assert.strictEqual(browser?.userId, "user-ada");
      assert.strictEqual(browser?.email, "ada@example.com");
      assert.strictEqual(agent?.kind, "mcp");
      assert.deepStrictEqual(agent?.cursor, { x: 10, y: 20 });
      // A blank name falls back to an anonymous one without changing the user's color.
      assert.strictEqual(agent?.displayName, Presence.fallbackName("mcp:session"));
      assert.strictEqual(agent?.color, Presence.colorFor("user-ada"));
      assert.strictEqual(browser?.color, agent?.color);
    }).pipe(Effect.provide(Presence.layer), Effect.scoped),
  );

  it.effect("expires touched clients after their TTL unless touched again", () =>
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      const api = userClient("api", "api:key", "user-ada");
      const changes: Presence.Changed[] = [];
      yield* withConnection(
        Presence.stream.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event._tag === "PresenceChanged") changes.push(event);
            }),
          ),
        ),
        identity("observer", "project"),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      yield* registry.touch(api, { activeGraph: "graph", ttl: "30 seconds" });
      const [touched] = (yield* registry.snapshot("project")).filter(
        (client) => client.id === "api:key",
      );
      assert.strictEqual(touched?.expiresAt, 30_000);
      assert.strictEqual(touched?.lastActiveAt, 0);

      yield* TestClock.adjust("20 seconds");
      yield* registry.touch(api, { activeGraph: "other", ttl: "30 seconds" });
      yield* TestClock.adjust("20 seconds");
      const refreshed = (yield* registry.snapshot("project")).find(
        (client) => client.id === "api:key",
      );
      assert.strictEqual(refreshed?.activeGraph, "other");
      assert.strictEqual(refreshed?.lastActiveAt, 20_000);

      yield* TestClock.adjust("11 seconds");
      assert.deepStrictEqual(
        (yield* registry.snapshot("project")).map((client) => client.id),
        ["observer"],
      );
      // Expiry is broadcast so open editors drop the entry without another change.
      assert.isFalse(changes.at(-1)?.clients.some((client) => client.id === "api:key") ?? true);
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("labels remote clients and keeps their graph across project-wide touches", () =>
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      const agent: EditorAccess.ConnectionIdentity = {
        ...userClient("mcp", "mcp:session", "user-ada"),
        remote: {
          apiKeyId: "key",
          apiKeyName: null,
          mcpSessionId: "session",
          mcpClientName: null,
          mcpClientVersion: "9",
        },
      };
      yield* registry.touch(agent, { activeGraph: "graph", cursor: { x: 1, y: 2 } });
      yield* registry.touch(agent, {});
      const [client] = yield* registry.snapshot("project");
      assert.strictEqual(client?.activeGraph, "graph");
      assert.deepStrictEqual(client?.cursor, { x: 1, y: 2 });
      assert.deepStrictEqual(client?.remote, {
        name: "MCP client",
        version: null,
        apiKeyName: null,
      });
      yield* registry.touch(agent, { activeGraph: "other" });
      assert.isNull((yield* registry.snapshot("project"))[0]?.cursor);

      yield* registry.apiKeyRevoked("key");
      assert.deepStrictEqual(yield* registry.snapshot("project"), []);
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("keeps stream-held clients when they are touched", () =>
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      const tab = userClient("browser", "tab", "user-ada");
      const scope = yield* Scope.make();
      yield* withConnection(registry.register, tab).pipe(Scope.provide(scope));
      yield* TestClock.adjust("5 seconds");
      yield* registry.touch(tab, { activeGraph: "graph", ttl: "1 second" });
      yield* TestClock.adjust("1 minute");
      const [client] = yield* registry.snapshot("project");
      assert.strictEqual(client?.expiresAt, null);
      assert.strictEqual(client?.activeGraph, null);
      assert.strictEqual(client?.lastActiveAt, 5_000);
      yield* Scope.close(scope, Exit.void);
      assert.deepStrictEqual(yield* registry.snapshot("project"), []);
    }).pipe(Effect.provide(Presence.layer)),
  );

  it.effect("validates viewports and touched locations", () =>
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      const connection = identity("viewer", "project");
      yield* withConnection(registry.register, connection);
      yield* withConnection(
        registry.update({
          ...graphUpdate(null),
          viewport: { x: -5, y: 5, width: 800, height: 600 },
        }),
        connection,
      );
      assert.deepStrictEqual((yield* registry.snapshot("project"))[0]?.viewport, {
        x: -5,
        y: 5,
        width: 800,
        height: 600,
      });
      for (const viewport of [
        { x: 0, y: 0, width: 0, height: 10 },
        { x: Number.NaN, y: 0, width: 10, height: 10 },
      ]) {
        const exit = yield* Effect.exit(
          withConnection(registry.update({ ...graphUpdate(null), viewport }), connection),
        );
        assert.isTrue(Exit.isFailure(exit));
      }
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            withConnection(
              registry.update({
                activeGraph: null,
                cursor: null,
                viewport: { x: 0, y: 0, width: 10, height: 10 },
                selectedNodeIds: [],
              }),
              connection,
            ),
          ),
        ),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            registry.touch(userClient("api", "api:key", "user"), {
              activeGraph: null,
              cursor: { x: 1, y: 1 },
            }),
          ),
        ),
      );
    }).pipe(Effect.provide(Presence.layer), Effect.scoped),
  );
});
