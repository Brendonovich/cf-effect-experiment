import { assert, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { Executor } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { DataType, Plugin } from "@macrograph/plugin";
import { Effect, Layer } from "effect";

import { PluginMount } from "../src/PluginMount.ts";

it.effect("registers an engine-less plugin without engine services, RPC clients, or storage", () =>
  Effect.gen(function* () {
    yield* (yield* Persistence.Service).saveProject(Project.empty());
    const plugin = Plugin.make({
      id: "stateless",
      effect: Effect.fnUntraced(function* (context) {
        yield* context.schema.register({
          id: "Value",
          type: "pure",
          io: (io) => ({ output: io.data.out("value", DataType.Int) }),
          run: ({ io }) => Effect.sync(() => io.output(42)),
        });
      }),
    });
    const executor = yield* Executor.make(Project.empty(), {
      engineClient: () => Effect.die("Stateless registration must not resolve an engine client"),
    });
    yield* PluginMount.register(executor, plugin);
    const packages = yield* Packages.Service;
    const catalog = yield* packages.getPackages();
    assert.deepStrictEqual(
      catalog.map((pkg) => pkg.id),
      ["stateless"],
    );
    assert.deepStrictEqual(catalog[0]?.resources, []);
    assert.deepStrictEqual(
      catalog[0]?.schemas.map((schema) => schema.id),
      ["Value"],
    );
    const editor = yield* Editor.Service;
    assert.strictEqual(
      (yield* editor.engine.getRuntimeClient(plugin.id).pipe(Effect.flip))._tag,
      "EngineNotHosted",
    );
    assert.strictEqual(
      (yield* editor.engine.getClientState(plugin.id).pipe(Effect.flip))._tag,
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
