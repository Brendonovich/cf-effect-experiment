import { expect, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { Executor } from "@macrograph/execution";
import { Engine, Module, ModuleId, Resource } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Array, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import { EngineHost } from "../src/EngineHost.ts";
import { ModuleMount } from "../src/ModuleMount.ts";

class Ping extends Schema.TaggedClass<Ping>()("UnmountPing", {}) {}
class Account extends Resource.make<Account, string>()("account", { name: "Account" }) {}
class HostedEngine extends Engine.make({
  resources: [Account],
  events: Array.empty<Ping>(),
  storage: Schema.Struct({ enabled: Schema.Boolean }),
  initialStorage: { enabled: false },
  rpcs: RpcGroup.make(Rpc.make("Hello", { success: Schema.String })),
  client: { state: Schema.Struct({ ready: Schema.Boolean }), rpcs: RpcGroup.make() },
}) {}

const HostedModule = Module.identify(
  ModuleId.Id.make("local/test/unmount"),
  Module.make({ engine: HostedEngine, effect: () => Effect.void }),
);
const deployment = Engine.identify(
  HostedModule.id,
  Engine.deployment(
    HostedModule,
    HostedEngine.toLayer(() =>
      Effect.succeed({
        resources: Account.toLayer(Effect.succeed([{ id: "a", display: "A" }])),
        rpcs: HostedEngine.Rpcs.toLayer({ Hello: () => Effect.succeed("hi") }),
        client: { state: Effect.succeed({ ready: true }), rpcs: Layer.empty },
      }),
    ),
  ),
);

const EditorLayer = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);

it.effect("closing a mount scope undoes the engine host, editor and executor registrations", () =>
  Effect.gen(function* () {
    yield* (yield* Persistence.Service).saveProject(Project.empty());
    const editor = yield* Editor.Service;
    const packages = yield* Packages.Service;
    const executor = yield* Executor.make(Project.empty());
    const before = (yield* packages.getPackages()).map((pkg) => pkg.id);

    const scope = yield* Scope.make();
    yield* Effect.gen(function* () {
      const context = yield* Layer.build(
        EngineHost.layer(
          deployment,
          EngineHost.editorContextLayer(deployment, { emit: () => Effect.void }),
        ).pipe(Layer.provide(Engine.emptyCredentialsLayer)),
      );
      const instance = Context.get(context, HostedEngine);
      yield* ModuleMount.register(executor, HostedModule, deployment, instance.client.state);
    }).pipe(Scope.provide(scope));

    expect(yield* editor.engine.getClientState(HostedModule.id)).toEqual({ ready: true });
    expect(yield* editor.engine.getResourceValues(HostedModule.id, "account")).toEqual([
      { id: "a", display: "A" },
    ]);
    yield* editor.engine.getRuntimeClient(HostedModule.id);
    yield* executor.handleEvent(HostedModule, new Ping());

    yield* Scope.close(scope, Exit.void);

    expect((yield* packages.getPackages()).map((pkg) => pkg.id)).toEqual(before);
    for (const lookup of [
      editor.engine.getClientState(HostedModule.id),
      editor.engine.getRuntimeClient(HostedModule.id),
    ])
      expect((yield* Effect.flip(lookup))._tag).toBe("EngineNotHosted");
    expect(
      (yield* Effect.flip(editor.engine.getResourceValues(HostedModule.id, "account")))._tag,
    ).toBe("InvalidResourceError");
    expect((yield* Effect.flip(executor.handleEvent(HostedModule, new Ping())))._tag).toBe(
      "ModuleUnavailable",
    );
  }).pipe(Effect.provide(EditorLayer)),
);
