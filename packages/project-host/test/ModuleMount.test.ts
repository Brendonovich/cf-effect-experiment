import { assert, it } from "@effect/vitest";
import { CustomTypes, Function as GraphFunction, Project } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { Executor } from "@macrograph/execution";
import { t, Module, ModuleId } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";

import { ModuleMount } from "../src/ModuleMount.ts";

it.effect("registers an engine-less module without engine services, RPC clients, or storage", () =>
  Effect.gen(function* () {
    yield* (yield* Persistence.Service).saveProject(Project.empty());
    const module = Module.identify(
      ModuleId.Id.make("local/test/stateless"),
      Module.make({
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "Value",
            type: "pure",
            io: (io) => ({ output: io.data.out("value", t.Int) }),
            run: ({ io }) => Effect.sync(() => io.output(42)),
          });
        }),
      }),
    );
    const executor = yield* Executor.make(Project.empty(), {
      engineClient: () => Effect.die("Stateless registration must not resolve an engine client"),
    });
    yield* ModuleMount.register(executor, module);
    const packages = yield* Packages.Service;
    const catalog = yield* packages.getPackages();
    assert.deepStrictEqual(
      catalog.map((pkg) => pkg.id),
      [CustomTypes.packageId, GraphFunction.packageId, "local/test/stateless"],
    );
    assert.deepStrictEqual(catalog.find((pkg) => pkg.id === "local/test/stateless")?.resources, []);
    assert.deepStrictEqual(
      catalog.find((pkg) => pkg.id === "local/test/stateless")?.schemas.map((schema) => schema.id),
      ["Value"],
    );
    const editor = yield* Editor.Service;
    assert.strictEqual(
      (yield* editor.engine.getRuntimeClient(module.id).pipe(Effect.flip))._tag,
      "EngineNotHosted",
    );
    assert.strictEqual(
      (yield* editor.engine.getClientState(module.id).pipe(Effect.flip))._tag,
      "EngineNotHosted",
    );
    assert.deepStrictEqual((yield* editor.project.get()).engines, {});
  }).pipe(
    Effect.provide(
      Editor.layer.pipe(
        Layer.provideMerge(EditorEvents.layer),
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);
