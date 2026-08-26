import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { UtilitiesEngine } from "../src/Definition.ts";
import { make } from "../src/Engine.ts";

describe("Utilities engine", () => {
  it.effect(
    "starts and stops idempotently, resumes its counter, and cancels with the engine scope",
    () =>
      Effect.gen(function* () {
        const ticks = yield* Ref.make<ReadonlyArray<number>>([]);
        const refreshes = yield* Ref.make(0);
        const context = Layer.succeed(
          UtilitiesEngine.EngineContext,
          UtilitiesEngine.EngineContext.of({
            storage: {
              get: Effect.die("Utilities has no persisted engine storage"),
              set: () => Effect.void,
              update: () => Effect.void,
            },
            resource: { refresh: () => Effect.void },
            credentials: {
              get: Effect.succeed([]),
              refresh: () => Effect.die("No credentials"),
              subscribe: () => Effect.void,
            },
            client: { refresh: Ref.update(refreshes, (value) => value + 1) },
            emit: (event) => Ref.update(ticks, (values) => [...values, event.tick]),
          }),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const { engine, client } = yield* EngineTest.makeClients(UtilitiesEngine);
            assert.deepStrictEqual(yield* engine.client.state, { running: true });
            yield* Effect.yieldNow;
            yield* TestClock.adjust("3 seconds");
            assert.deepStrictEqual(yield* Ref.get(ticks), [1, 2, 3]);

            yield* Effect.all([client.StopTick(), client.StopTick()], { concurrency: "unbounded" });
            assert.deepStrictEqual(yield* engine.client.state, { running: false });
            assert.strictEqual(yield* Ref.get(refreshes), 2);
            yield* TestClock.adjust("2 seconds");
            assert.deepStrictEqual(yield* Ref.get(ticks), [1, 2, 3]);

            yield* Effect.all([client.StartTick(), client.StartTick()], {
              concurrency: "unbounded",
            });
            assert.deepStrictEqual(yield* engine.client.state, { running: true });
            assert.strictEqual(yield* Ref.get(refreshes), 3);
            yield* TestClock.adjust("999 millis");
            assert.deepStrictEqual(yield* Ref.get(ticks), [1, 2, 3]);
            yield* TestClock.adjust("1 milli");
            assert.deepStrictEqual(yield* Ref.get(ticks), [1, 2, 3, 4]);
          }).pipe(Effect.provide(make()), Effect.provide(context)),
        );
        yield* TestClock.adjust("2 seconds");
        assert.deepStrictEqual(yield* Ref.get(ticks), [1, 2, 3, 4]);
      }),
  );

  it.effect("supports an inert host without starting a ticker", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const context = Layer.succeed(
        UtilitiesEngine.EngineContext,
        UtilitiesEngine.EngineContext.of({
          storage: {
            get: Effect.die("Utilities has no persisted engine storage"),
            set: () => Effect.void,
            update: () => Effect.void,
          },
          resource: { refresh: () => Effect.void },
          credentials: {
            get: Effect.succeed([]),
            refresh: () => Effect.die("No credentials"),
            subscribe: () => Effect.void,
          },
          client: { refresh: Effect.void },
          emit: () => Ref.update(ticks, (value) => value + 1),
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { engine } = yield* EngineTest.makeClients(UtilitiesEngine);
          assert.deepStrictEqual(yield* engine.client.state, { running: false });
          yield* TestClock.adjust("2 seconds");
          assert.strictEqual(yield* Ref.get(ticks), 0);
        }).pipe(Effect.provide(make({ startTicker: false })), Effect.provide(context)),
      );
      yield* TestClock.adjust("2 seconds");
      assert.strictEqual(yield* Ref.get(ticks), 0);
    }),
  );
});
