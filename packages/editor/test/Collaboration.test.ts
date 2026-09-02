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
  actor: { type: "CLIENT", id: connectionId },
  connectionId,
  displayName: connectionId,
  projectId,
  canEdit,
  canManageCredentials,
});

const withConnection = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  value: EditorAccess.ConnectionIdentity,
) => Effect.provideService(effect, EditorAccess.Connection, value);

describe("collaboration", () => {
  it.effect("serializes actors and suppresses only a client's own events", () =>
    Effect.gen(function* () {
      const client = { type: "CLIENT" as const, id: "connection-a" };
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
      assert.isFalse(EditorRpc.isEventVisibleTo(own, "connection-a"));
      assert.isTrue(EditorRpc.isEventVisibleTo(own, "connection-b"));
      assert.isTrue(
        EditorRpc.isEventVisibleTo({ ...own, actor: { type: "SYSTEM" } }, "connection-a"),
      );
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
      assert.isFalse(EditorRpc.isEventVisibleTo(defaultChanged, "connection-a"));
      assert.isTrue(EditorRpc.isEventVisibleTo(defaultChanged, "connection-b"));
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
          selectedNodeIds: [],
        }),
        projectA,
      );
      assert.deepStrictEqual((yield* withConnection(registry.snapshot, projectA))[0]?.cursor, {
        x: 1,
        y: 2,
      });
      assert.strictEqual((yield* withConnection(registry.snapshot, projectB))[0]?.cursor, null);

      yield* withConnection(
        registry.update({
          activeGraph: "graph-a",
          cursor: { x: 1, y: 2 },
          selectedNodeIds: ["node-a", "node-b"],
        }),
        projectA,
      );
      yield* withConnection(registry.nodeDeleted("graph-a", "node-a"), projectA);
      assert.deepStrictEqual(
        (yield* withConnection(registry.snapshot, projectA))[0]?.selectedNodeIds,
        ["node-b"],
      );
      yield* withConnection(registry.graphDeleted("graph-a"), projectA);
      assert.deepStrictEqual((yield* withConnection(registry.snapshot, projectA))[0], {
        connectionId: "shared",
        displayName: "shared",
        color: Presence.colorFor("shared"),
        canEdit: true,
        activeGraph: null,
        cursor: null,
        selectedNodeIds: [],
      });
      assert.strictEqual((yield* withConnection(registry.snapshot, projectB))[0]?.cursor, null);

      yield* Scope.close(scopeA, Exit.void);
      assert.strictEqual((yield* withConnection(registry.snapshot, projectB)).length, 1);
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
        (yield* withConnection(registry.snapshot, projectA)).map((client) => client.connectionId),
        ["a"],
      );
      assert.deepStrictEqual(
        (yield* withConnection(registry.snapshot, projectB)).map((client) => client.connectionId),
        ["b"],
      );
      yield* Scope.close(scopeA, Exit.void);
      assert.deepStrictEqual(yield* withConnection(registry.snapshot, projectA), []);
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
      yield* withConnection(
        registry.update({ activeGraph: "graph", cursor: { x: 1, y: 1 }, selectedNodeIds: [] }),
        connection,
      );
      yield* withConnection(
        registry.update({ activeGraph: "graph", cursor: { x: 2, y: 3 }, selectedNodeIds: [] }),
        connection,
      );
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
        yield* withConnection(
          registry.update({ activeGraph: "graph", cursor: { x, y: 0 }, selectedNodeIds: ["node"] }),
          connection,
        );
        yield* TestClock.adjust("10 millis");
        if (x % 2 === 1) {
          assert.deepStrictEqual(changes.at(-1)?.clients[0]?.cursor, { x, y: 0 });
        }
      }

      yield* withConnection(
        registry.update({ activeGraph: "graph", cursor: null, selectedNodeIds: ["node"] }),
        connection,
      );
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
      assert.strictEqual((yield* withConnection(registry.snapshot, connection)).length, 1);
      yield* Fiber.interrupt(fiber);
      assert.deepStrictEqual(yield* withConnection(registry.snapshot, connection), []);
    }).pipe(Effect.provide(Presence.layer)),
  );
});
