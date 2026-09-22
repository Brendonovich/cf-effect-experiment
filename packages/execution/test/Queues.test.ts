import { assert, describe, it } from "@effect/vitest";
import { CanvasId, Queue } from "@macrograph/core";
import { Deferred, Effect, Exit, Fiber, Stream } from "effect";

import { Queues } from "../src/index.ts";

const definition = (id: string): Queue.Model => ({
  canvas: { id: CanvasId.make(id), name: id, nodes: {}, connections: [] },
  arguments: [],
  returns: [],
  inputPosition: { x: 0, y: 0 },
  outputPosition: { x: 400, y: 0 },
});
const definitions = { first: definition("first"), second: definition("second") };
const waitFor = (queues: Queues.Service, predicate: (state: Queues.State) => boolean) =>
  queues.changes.pipe(
    Stream.filter((states) => states.some(predicate)),
    Stream.runHead,
  );

describe("Queues", () => {
  it.effect("captures inputs and dispatches each queue FIFO and single-flight", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const calls: Array<readonly [string, unknown]> = [];
      const queues = yield* Queues.make(definitions, (queueId, inputs) =>
        Effect.gen(function* () {
          calls.push([queueId, inputs.value]);
          if (inputs.value === 1) yield* Deferred.await(release);
          return inputs;
        }),
      );
      const values = { value: 1 };
      const first = yield* queues.enqueue("first", values).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.queueId === "first" && state.running.length === 1);
      values.value = 99;
      const second = yield* queues.enqueue("first", { value: 2 }).pipe(Effect.forkChild);
      assert.deepStrictEqual(yield* queues.enqueue("second", { value: 3 }), { value: 3 });
      yield* waitFor(queues, (state) => state.queueId === "first" && state.waiting.length === 1);
      assert.deepStrictEqual(calls, [
        ["first", 1],
        ["second", 3],
      ]);
      yield* Deferred.succeed(release, undefined);
      assert.deepStrictEqual(yield* Fiber.join(first), { value: 1 });
      assert.deepStrictEqual(yield* Fiber.join(second), { value: 2 });
    }).pipe(Effect.scoped),
  );

  it.effect("pause, advance, remove, and clear control live work", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, () => Effect.never);
      yield* queues.pause("first", true);
      const one = yield* queues.enqueue("first", {}).pipe(Effect.exit, Effect.forkChild);
      const two = yield* queues.enqueue("first", {}).pipe(Effect.exit, Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 2);
      const item = (yield* queues.snapshot)[0]!.waiting[0]!;
      yield* queues.remove("first", item.id);
      assert.isTrue(Exit.isFailure(yield* Fiber.join(one)));
      assert.isTrue(Exit.isFailure(yield* queues.advance("first").pipe(Effect.exit)));
      yield* queues.clear("first");
      assert.isTrue(Exit.isFailure(yield* Fiber.join(two)));
    }).pipe(Effect.scoped),
  );

  it.effect("rejects direct and transitive runtime lineage cycles", () =>
    Effect.gen(function* () {
      let queues: Queues.Service;
      queues = yield* Queues.make(definitions, (queueId) =>
        queueId === "first" ? queues.enqueue("second", {}) : queues.enqueue("first", {}),
      );
      assert.isTrue(Exit.isFailure(yield* queues.enqueue("first", {}).pipe(Effect.exit)));
    }).pipe(Effect.scoped),
  );

  it.effect("deleting a queue settles its pending callers", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, () => Effect.never);
      yield* queues.pause("first", true);
      const pending = yield* queues.enqueue("first", {}).pipe(Effect.exit, Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 1);
      yield* queues.configure({ second: definitions.second });
      assert.isTrue(Exit.isFailure(yield* Fiber.join(pending)));
      assert.deepStrictEqual(
        (yield* queues.snapshot).map((state) => state.queueId),
        ["second"],
      );
    }).pipe(Effect.scoped),
  );
});
