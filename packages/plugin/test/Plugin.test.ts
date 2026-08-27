import { assert, describe, it } from "@effect/vitest";
import { Array, Effect, Schema } from "effect";
import { expectTypeOf } from "vitest";

import { DataType, Engine, Plugin, Registration } from "../src/index.ts";

describe("Plugin.make", () => {
  it.effect("infers an engine-less context and typed IO without type arguments", () =>
    Effect.gen(function* () {
      const plugin = Plugin.make({
        id: "stateless",
        effect: Effect.fnUntraced(function* (context) {
          expectTypeOf(context).toEqualTypeOf<Registration.PluginContext<never>>();
          yield* context.schema.register({
            id: "Increment",
            type: "pure",
            io: (io) => ({
              input: io.data.in("input", DataType.Int),
              output: io.data.out("output", DataType.Int),
            }),
            run: ({ io, engine }) => {
              expectTypeOf(engine).toEqualTypeOf<never>();
              expectTypeOf(io.input).toEqualTypeOf<number>();
              return Effect.sync(() => io.output(io.input + 1));
            },
          });
        }),
      });
      expectTypeOf(plugin).toEqualTypeOf<Plugin.Plugin<never>>();
      assert.isUndefined(plugin.engine);
      assert.deepStrictEqual(
        (yield* Registration.collect(plugin.effect)).map((schema) => schema.id),
        ["Increment"],
      );
    }),
  );

  it.effect("preserves engine and event inference when an engine is supplied", () =>
    Effect.gen(function* () {
      class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {}) {}
      class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
      const plugin = Plugin.make({
        id: "stateful",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          expectTypeOf(context).toEqualTypeOf<Registration.PluginContext<typeof TestEngine>>();
          yield* context.schema.register({
            id: "Trigger",
            type: "event",
            event: (event) => {
              expectTypeOf(event).toEqualTypeOf<Trigger>();
              return Effect.succeed(event._tag === "Trigger");
            },
            io: () => ({}),
            run: () => Effect.void,
          });
        }),
      });
      expectTypeOf(plugin).toEqualTypeOf<Plugin.Plugin<typeof TestEngine>>();
      assert.strictEqual(plugin.engine, TestEngine);
      assert.lengthOf(yield* Registration.collect(plugin.effect), 1);
    }),
  );
});
