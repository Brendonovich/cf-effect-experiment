import { Effect, Fiber, Layer, Ref, Semaphore } from "effect";

import { ClientRpcs, TickEvent, UtilitiesEngine } from "./Definition.ts";

export const make = (options?: { readonly startTicker?: boolean }) =>
  UtilitiesEngine.toLayer((mg) =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const lock = yield* Semaphore.make(1);
      const tick = yield* Ref.make(0);
      let ticker: Fiber.Fiber<void> | undefined;

      const start = Effect.gen(function* () {
        if (ticker !== undefined) return;
        ticker = yield* Effect.gen(function* () {
          yield* Effect.sleep("1 second");
          const current = yield* Ref.updateAndGet(tick, (value) => value + 1);
          yield* mg.emit(new TickEvent({ tick: current }));
        }).pipe(Effect.forever, Effect.forkIn(scope));
        yield* mg.client.refresh;
      }).pipe(lock.withPermit, Effect.uninterruptible);

      const stop = Effect.gen(function* () {
        if (ticker === undefined) return;
        yield* Fiber.interrupt(ticker);
        ticker = undefined;
        yield* mg.client.refresh;
      }).pipe(lock.withPermit, Effect.uninterruptible);

      if (options?.startTicker !== false) yield* start;

      return {
        resources: Layer.empty,
        rpcs: Layer.empty,
        client: {
          state: Effect.sync(() => ({ running: ticker !== undefined })),
          rpcs: ClientRpcs.toLayer({ StartTick: () => start, StopTick: () => stop }),
        },
      };
    }),
  );

export default make();
