import { assert, describe, it } from "@effect/vitest";
import { Queue } from "@macrograph/core";
import { Effect, Exit, Stream } from "effect";

import * as CloudQueueRuntime from "../src/editor/CloudQueueRuntime.ts";

describe("Cloud editor queue management", () => {
  it.effect("resolves project identity lazily and forwards every management operation", () =>
    Effect.gen(function* () {
      let projectId: string | undefined;
      const calls: unknown[][] = [];
      const state: Queue.State[] = [{ queueId: "queue", paused: false, waiting: [], running: [] }];
      const runtime = CloudQueueRuntime.make(() => projectId, {
        queueSnapshot: (id) =>
          Effect.sync(() => {
            calls.push(["snapshot", id]);
            return state;
          }),
        queuePause: (...args) =>
          Effect.sync(() => {
            calls.push(["pause", ...args]);
          }),
        queueAdvance: (...args) =>
          Effect.sync(() => {
            calls.push(["advance", ...args]);
          }),
        queueRemove: (...args) =>
          Effect.sync(() => {
            calls.push(["remove", ...args]);
          }),
        queueClear: (...args) =>
          Effect.sync(() => {
            calls.push(["clear", ...args]);
          }),
      });
      assert.deepStrictEqual(yield* runtime.snapshot, []);
      assert.isTrue(Exit.isFailure(yield* Effect.exit(runtime.pause("queue", true))));
      assert.deepStrictEqual(calls, []);
      projectId = "project";
      assert.deepStrictEqual(yield* runtime.changes.pipe(Stream.take(1), Stream.runCollect), [
        state,
      ]);
      yield* runtime.pause("queue", true);
      yield* runtime.advance("queue");
      yield* runtime.remove("queue", "item");
      yield* runtime.clear("queue");
      assert.deepStrictEqual(calls, [
        ["snapshot", "project"],
        ["pause", "project", "queue", true],
        ["advance", "project", "queue"],
        ["remove", "project", "queue", "item"],
        ["clear", "project", "queue"],
      ]);
    }),
  );

  it.effect("preserves domain errors from the deployed scheduler", () =>
    Effect.gen(function* () {
      const error = new Queue.NotFoundError({ id: "missing" });
      const runtime = CloudQueueRuntime.make(() => "project", {
        queueSnapshot: () => Effect.succeed([]),
        queuePause: () => Effect.fail(error),
        queueAdvance: () => Effect.fail(error),
        queueRemove: () => Effect.fail(error),
        queueClear: () => Effect.fail(error),
      });
      assert.deepStrictEqual(yield* Effect.exit(runtime.advance("missing")), Exit.fail(error));
    }),
  );
});
