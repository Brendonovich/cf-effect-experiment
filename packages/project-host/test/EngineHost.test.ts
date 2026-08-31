import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { Engine, HttpEndpoint, Plugin } from "@macrograph/plugin";
import { Effect, Layer, PubSub, Schema } from "effect";

import { EngineHost } from "../src/EngineHost.ts";

it.effect("reconciles endpoints after saving storage", () => {
  const HostedEngine = Engine.make({
    storage: Schema.Struct({ enabled: Schema.Boolean }),
    initialStorage: { enabled: false },
  });
  let storage = { enabled: false };
  const operations: Array<string> = [];
  const endpoint = {
    id: HttpEndpoint.Id.make("endpoint-1"),
    url: "https://example.com/endpoint-1",
    schema: { id: HttpEndpoint.HandlerId.make("test:event"), displayName: "Test Event" },
    instanceKey: HttpEndpoint.InstanceKey.make("primary"),
    metadata: {},
  };
  const layer = EngineHost.contextLayer(HostedEngine, {
    storage: {
      get: Effect.sync(() => storage),
      save: (state) =>
        Effect.sync(() => {
          operations.push("save");
          storage = state;
        }),
    },
    reconcile: () =>
      Effect.sync(() => {
        operations.push("reconcile");
        return [endpoint];
      }),
    setEndpoints: () => Effect.sync(() => void operations.push("endpoints")),
    resource: { refresh: () => Effect.void },
    credentials: {
      get: Effect.succeed([]),
      refresh: () => Effect.die("No credentials"),
      subscribe: () => Effect.void,
    },
    client: { refresh: Effect.void },
    emit: () => Effect.void,
  });

  return Effect.gen(function* () {
    const context = yield* HostedEngine.EngineContext;
    yield* context.storage.update((state) => ({ enabled: !state.enabled }));
    expect(storage).toEqual({ enabled: true });
    expect(operations).toEqual(["save", "reconcile", "endpoints"]);
  }).pipe(Effect.provide(layer));
});

it.effect("persists editor-backed storage and endpoints", () => {
  const HostedEngine = Engine.make({
    storage: Schema.Struct({ enabled: Schema.Boolean }),
    initialStorage: { enabled: false },
  });
  const HostedPlugin = Plugin.make({
    id: "hosted",
    engine: HostedEngine,
    effect: () => Effect.void,
  });
  const deployment = Engine.deployment(
    HostedPlugin,
    HostedEngine.toLayer(() => Effect.die("Test engine is not hosted")),
  );
  const endpoint = {
    id: HttpEndpoint.Id.make("endpoint-1"),
    url: "https://example.com/endpoint-1",
    schema: { id: HttpEndpoint.HandlerId.make("test:event"), displayName: "Test Event" },
    instanceKey: HttpEndpoint.InstanceKey.make("primary"),
    metadata: {},
  };
  const seedLayer = Layer.effectDiscard(
    Effect.flatMap(Persistence.Service, (persistence) =>
      persistence.saveProject({ name: "test", graphs: {}, engines: {}, constants: {}, queues: {} }),
    ),
  );
  const editorLayer = Editor.defaultLayer.pipe(
    Layer.provide(seedLayer),
    Layer.provideMerge(Packages.defaultLayer),
    Layer.provideMerge(Persistence.layerMemory),
    Layer.provide(NodeServices.layer),
  );
  const layer = EngineHost.editorContextLayer(deployment, {
    emit: () => Effect.void,
    reconcile: () => Effect.succeed([endpoint]),
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Engine.Credentials, {
          get: Effect.succeed([]),
          refresh: () => Effect.die("No credentials"),
          subscribe: () => Effect.void,
        }),
        editorLayer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const context = yield* HostedEngine.EngineContext;
    const editor = yield* Editor.Service;
    const events = yield* EditorEvents.Service.pipe(Effect.flatMap((events) => events.subscribe));
    yield* editor.plugin(HostedPlugin, deployment);
    yield* context.storage.update((state) => ({ enabled: !state.enabled }));
    expect((yield* editor.project.get()).engines.hosted).toEqual({ enabled: true });
    expect(yield* editor.engine.getEndpoints()).toEqual([endpoint]);
    yield* context.client.refresh;
    expect(yield* PubSub.take(events)).toEqual({
      _tag: "EngineStateChanged",
      actor: { type: "SYSTEM" },
      pluginId: "hosted",
      state: { enabled: true },
    });
    expect(yield* PubSub.take(events)).toEqual({
      _tag: "PluginClientStateDirty",
      actor: { type: "SYSTEM" },
      pluginId: "hosted",
    });
  }).pipe(Effect.provide(layer), Effect.provide(editorLayer));
});
