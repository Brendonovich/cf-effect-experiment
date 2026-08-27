import { assert, describe, it } from "@effect/vitest";
import { Actor, GraphId, Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Engine } from "@macrograph/plugin";
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { RpcGroup, RpcSerialization, RpcTest } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  EditorServer,
  Packages,
  Presence,
} from "../src/index.ts";

const services = EditorRpc.handlerLayer.pipe(
  Layer.provideMerge(EditorRpc.connectionMiddlewareLayer),
  Layer.provideMerge(
    Editor.layer.pipe(
      Layer.provideMerge(EditorEvents.layer),
      Layer.provideMerge(Packages.defaultLayer),
    ),
  ),
  Layer.provide(Presence.layer),
  Layer.provide(Engine.emptyCredentialsLayer),
  Layer.provideMerge(Persistence.layerMemory),
);

const policy = (canEdit: boolean) =>
  Layer.succeed(EditorAccess.Policy, {
    resolve: () =>
      Effect.succeed({
        actor: { type: "CLIENT" as const, id: "privacy-client" },
        connectionId: "privacy-client",
        displayName: "Privacy test",
        projectId: "privacy-project",
        canEdit,
        canManageCredentials: canEdit,
      }),
  });

const stored = {
  ...Project.empty(),
  graphs: {
    graph: { id: GraphId.make("graph"), name: "Public graph", nodes: {}, connections: [] },
  },
  engines: { integration: { token: "private-token" } },
};

describe("Engine storage privacy", () => {
  it.effect("sanitizes actual raw WebSocket broadcast frames", () =>
    Effect.gen(function* () {
      yield* (yield* Persistence.Service).saveProject(stored);
      const frames = yield* Queue.make<Uint8Array>();
      const opened = yield* Deferred.make<void>();
      const socket = Socket.make({
        runRaw: () => Deferred.succeed(opened, undefined).pipe(Effect.andThen(Effect.never)),
        writer: Effect.succeed((data) =>
          data instanceof Uint8Array ? Queue.offer(frames, data).pipe(Effect.asVoid) : Effect.void,
        ),
      });
      const { httpEffect } = yield* EditorServer.toDualHttpEffectWebsocket(RpcGroup.make());
      const request = HttpServerRequest.fromWeb(new Request("http://localhost/rpc-ws"));
      yield* httpEffect.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          new Proxy(request, {
            get: (target, key, receiver) =>
              key === "upgrade" ? Effect.succeed(socket) : Reflect.get(target, key, receiver),
          }),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(opened);
      const events = yield* EditorEvents.Service;
      yield* events.publish({
        _tag: "EngineStateChanged",
        pluginId: "integration",
        state: { token: "private-token" },
      });
      const frame = yield* Queue.take(frames);
      assert.strictEqual(frame[0], 1);
      const text = new TextDecoder().decode(frame.subarray(1));
      assert.deepStrictEqual(JSON.parse(text), {
        _tag: "PluginClientStateDirty",
        actor: Actor.system,
        pluginId: "integration",
      });
      assert.notInclude(text, "private-token");
    }).pipe(
      Effect.scoped,
      Effect.provide(EditorEvents.layer),
      Effect.provide(Persistence.layerMemory),
      Effect.provide(RpcSerialization.layerJsonRpc()),
    ),
  );

  it.effect("hides persisted storage from reader project reads, snapshots, and updates", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      yield* persistence.saveProject(stored);
      const client = yield* RpcTest.makeClient(EditorRpc.EditorRpcs);
      const project = yield* client.GetProject({});
      assert.deepStrictEqual(project.engines, {});
      assert.deepStrictEqual(project.graphs, stored.graphs);
      const received = yield* Deferred.make<void>();
      const stream = yield* client.ProjectEventsStream().pipe(
        Stream.tap((event) =>
          event._tag === "ProjectSnapshot" ? Deferred.succeed(received, undefined) : Effect.void,
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(received);
      const events = yield* EditorEvents.Service;
      yield* events.publish({
        _tag: "EngineStateChanged",
        pluginId: "integration",
        state: { token: "updated-private-token" },
      });
      const results = yield* Fiber.join(stream);
      assert.strictEqual(results[0]?._tag, "ProjectSnapshot");
      if (results[0]?._tag === "ProjectSnapshot") {
        assert.deepStrictEqual(results[0].snapshot.project.engines, {});
        assert.deepStrictEqual(results[0].snapshot.project.graphs, stored.graphs);
        assert.deepStrictEqual(results[0].snapshot.nodeIO, { graph: {} });
      }
      assert.deepStrictEqual(results[1], {
        _tag: "PluginClientStateDirty",
        actor: Actor.system,
        pluginId: "integration",
      });
      assert.notInclude(JSON.stringify(results), "private-token");
      assert.deepStrictEqual((yield* persistence.loadProject()).engines, {
        integration: { token: "updated-private-token" },
      });
    }).pipe(Effect.scoped, Effect.provide(services), Effect.provide(policy(false))),
  );

  it.effect("preserves full project access for authorized editors", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      yield* persistence.saveProject(stored);
      const client = yield* RpcTest.makeClient(EditorRpc.EditorRpcs);
      assert.deepStrictEqual((yield* client.GetProject({})).engines, stored.engines);
      const received = yield* Deferred.make<void>();
      const stream = yield* client.ProjectEventsStream().pipe(
        Stream.tap((event) =>
          event._tag === "ProjectSnapshot" ? Deferred.succeed(received, undefined) : Effect.void,
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(received);
      const events = yield* EditorEvents.Service;
      yield* events.publish({
        _tag: "EngineStateChanged",
        pluginId: "integration",
        state: { token: "updated-private-token" },
      });
      const results = yield* Fiber.join(stream);
      assert.strictEqual(results[0]?._tag, "ProjectSnapshot");
      if (results[0]?._tag === "ProjectSnapshot")
        assert.deepStrictEqual(results[0].snapshot.project.engines, stored.engines);
      assert.deepStrictEqual(results[1], {
        _tag: "EngineStateChanged",
        actor: Actor.system,
        pluginId: "integration",
        state: { token: "updated-private-token" },
      });
    }).pipe(Effect.scoped, Effect.provide(services), Effect.provide(policy(true))),
  );
});
