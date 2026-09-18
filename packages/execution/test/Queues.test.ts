import { assert, describe, it } from "@effect/vitest";
import { Queue } from "@macrograph/core";
import { Deferred, Effect, Exit, Fiber, Option, Scope, Stream } from "effect";

import { Queues } from "../src/index.ts";

const definitions = {
  first: { id: Queue.QueueId.make("first"), name: "First" },
  second: { id: Queue.QueueId.make("second"), name: "Second" },
};
const waitFor = (queues: Queues.Service, predicate: (state: Queues.State) => boolean) =>
  queues.changes.pipe(
    Stream.filter((states) => states.some(predicate)),
    Stream.runHead,
  );

describe("Queues", () => {
  it.effect("queues on the same project execute independently", () => Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    const queues = yield* Queues.make(definitions, (id) => id === "blocked" ? Deferred.await(release).pipe(Effect.as({})) : Effect.succeed({ independent: true }));
    const blocked = yield* queues.enqueue("first", "blocked", {}).pipe(Effect.forkChild);
    yield* waitFor(queues, (state) => state.queueId === "first" && state.running.length === 1);
    assert.deepStrictEqual(yield* queues.enqueue("second", "free", {}), { independent: true });
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(blocked);
  }).pipe(Effect.scoped));
  it.effect("captures arguments, returns results, and dispatches FIFO single-flight", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const calls: string[] = [];
      const queues = yield* Queues.make(definitions, (id, values) =>
        Effect.gen(function* () {
          calls.push(id);
          yield* Deferred.succeed(started, undefined);
          if (id === "one") yield* Deferred.await(release);
          return values;
        }),
      );
      yield* queues.pause("first", true);
      const values = { nested: { number: 1 } };
      const one = yield* queues.enqueue("first", "one", values).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 1);
      values.nested.number = 2;
      const two = yield* queues.enqueue("first", "two", { number: 2 }).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 2);
      yield* queues.pause("first", false);
      yield* waitFor(queues, (state) => state.running.length === 1);
      yield* Deferred.await(started);
      assert.deepStrictEqual(calls, ["one"]);
      yield* Deferred.succeed(release, undefined);
      assert.deepStrictEqual(yield* Fiber.join(one), { nested: { number: 1 } });
      assert.deepStrictEqual(yield* Fiber.join(two), { number: 2 });
      assert.deepStrictEqual(calls, ["one", "two"]);
    }).pipe(Effect.scoped),
  );

  it.effect("Advance overlaps and waits for all overlaps before automatic dispatch", () =>
    Effect.gen(function* () {
      const gates = [yield* Deferred.make<void>(), yield* Deferred.make<void>()];
      const calls: string[] = [];
      const queues = yield* Queues.make(definitions, (id) =>
        Effect.gen(function* () {
          calls.push(id);
          const gate = gates[Number(id)];
          if (gate) yield* Deferred.await(gate);
          return {};
        }),
      );
      const first = yield* queues.enqueue("first", "0", {}).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.running.length === 1);
      const second = yield* queues.enqueue("first", "1", {}).pipe(Effect.forkChild);
      const third = yield* queues.enqueue("first", "2", {}).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 2);
      yield* queues.advance("first");
      yield* waitFor(queues, (state) => state.running.length === 2);
      yield* Deferred.succeed(gates[1]!, undefined);
      yield* Fiber.join(second);
      assert.deepStrictEqual(calls, ["0", "1"]);
      assert.strictEqual((yield* queues.snapshot)[0]!.waiting.length, 1);
      yield* Deferred.succeed(gates[0]!, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(third);
      assert.deepStrictEqual(calls, ["0", "1", "2"]);
    }).pipe(Effect.scoped),
  );

  it.effect("pause is non-interrupting and Advance rejects a paused queue", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const queues = yield* Queues.make(definitions, () =>
        Deferred.await(release).pipe(Effect.as({ ok: true })),
      );
      const first = yield* queues.enqueue("first", "one", {}).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.running.length === 1);
      yield* queues.pause("first", true);
      const second = yield* queues.enqueue("first", "two", {}).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 1);
      assert.isTrue(Exit.isFailure(yield* queues.advance("first").pipe(Effect.exit)));
      yield* Deferred.succeed(release, undefined);
      assert.deepStrictEqual(yield* Fiber.join(first), { ok: true });
      assert.strictEqual((yield* queues.snapshot)[0]!.waiting.length, 1);
      yield* queues.pause("first", false);
      yield* Fiber.join(second);
    }).pipe(Effect.scoped),
  );

  it.effect("failure and defects settle callers and let later work continue", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, (id) =>
        id === "fail"
          ? Effect.fail("failure")
          : id === "defect"
            ? Effect.die("defect")
            : Effect.succeed({ ok: true }),
      );
      for (const id of ["fail", "defect"]) {
        const result = yield* queues.enqueue("first", id, {}).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(result));
      }
      assert.deepStrictEqual(yield* queues.enqueue("first", "ok", {}), { ok: true });
    }).pipe(Effect.scoped),
  );

  it.effect("remove and clear fail both waiting and running callers", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, () => Effect.never);
      const running = yield* queues
        .enqueue("first", "running", {})
        .pipe(Effect.exit, Effect.forkChild);
      yield* waitFor(queues, (state) => state.running.length === 1);
      const waiting = yield* queues
        .enqueue("first", "waiting", {})
        .pipe(Effect.exit, Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 1);
      const item = (yield* queues.snapshot)[0]!.waiting[0]!;
      yield* queues.remove("first", item.id);
      assert.isTrue(Exit.isFailure(yield* Fiber.join(waiting)));
      yield* queues.clear("first");
      assert.isTrue(Exit.isFailure(yield* Fiber.join(running)));
      yield* waitFor(queues, (state) => state.queueId === "first" && state.running.length === 0);
    }).pipe(Effect.scoped),
  );

  it.effect("deleting a definition settles work and isolates projects and queues", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, () => Effect.never);
      const other = yield* Queues.make(definitions, () => Effect.succeed({ other: true }));
      yield* queues.pause("first", true);
      const waiting = yield* queues
        .enqueue("first", "waiting", {})
        .pipe(Effect.exit, Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 1);
      assert.deepStrictEqual(yield* other.enqueue("first", "ok", {}), { other: true });
      yield* queues.configure({ second: definitions.second });
      assert.isTrue(Exit.isFailure(yield* Fiber.join(waiting)));
      assert.isTrue(
        Exit.isFailure(yield* queues.enqueue("first", "missing", {}).pipe(Effect.exit)),
      );
      assert.deepStrictEqual(
        (yield* queues.snapshot).map((state) => state.queueId),
        ["second"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("rejects same-queue and transitive awaited queue lineage cycles", () =>
    Effect.gen(function* () {
      let queues: Queues.Service;
      queues = yield* Queues.make(definitions, (id) =>
        id === "same"
          ? queues.enqueue("first", "end", {})
          : id === "transitive"
            ? queues.enqueue("second", "same", {})
            : Effect.succeed({ ok: true }),
      );
      for (const id of ["same", "transitive"]) {
        assert.isTrue(Exit.isFailure(yield* queues.enqueue("first", id, {}).pipe(Effect.exit)));
      }
      assert.deepStrictEqual(yield* queues.enqueue("first", "end", {}), { ok: true });
    }).pipe(Effect.scoped),
  );

  it.effect("caller interruption removes waiting work", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, () => Effect.succeed({}));
      yield* queues.pause("first", true);
      const caller = yield* queues.enqueue("first", "waiting", {}).pipe(Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 1);
      yield* Fiber.interrupt(caller);
      assert.strictEqual((yield* queues.snapshot)[0]!.waiting.length, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("runtime shutdown settles waiting callers without restart persistence", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const queues = yield* Queues.make(definitions, () => Effect.never).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      yield* queues.pause("first", true);
      const caller = yield* queues
        .enqueue("first", "waiting", {})
        .pipe(Effect.exit, Effect.forkChild);
      yield* waitFor(queues, (state) => state.waiting.length === 1);
      yield* Scope.close(scope, Exit.void);
      assert.isTrue(Exit.isFailure(yield* Fiber.join(caller)));
      assert.deepStrictEqual(yield* queues.snapshot, []);
      assert.isTrue(Option.isNone(yield* queues.changes.pipe(Stream.runHead)));
    }),
  );

  it.effect("a synchronous invocation throw settles its caller and recovers", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, (id) => {
        if (id === "throw") throw new Error("synchronous failure");
        return Effect.succeed({ ok: true });
      });
      assert.isTrue(Exit.isFailure(yield* queues.enqueue("first", "throw", {}).pipe(Effect.exit)));
      assert.deepStrictEqual(yield* queues.enqueue("first", "ok", {}), { ok: true });
    }).pipe(Effect.scoped),
  );

  it.effect("rejects overflow without dropping or hanging older callers", () =>
    Effect.gen(function* () {
      const queues = yield* Queues.make(definitions, () => Effect.succeed({}));
      yield* queues.pause("first", true);
      const callers = yield* Effect.forEach(Array.from({ length: 500 }), () =>
        queues.enqueue("first", "waiting", {}).pipe(Effect.exit, Effect.forkChild),
      );
      yield* waitFor(queues, (state) => state.waiting.length === 500);
      assert.isTrue(
        Exit.isFailure(yield* queues.enqueue("first", "overflow", {}).pipe(Effect.exit)),
      );
      assert.strictEqual((yield* queues.snapshot)[0]!.waiting.length, 500);
      yield* queues.clear("first");
      const results = yield* Effect.forEach(callers, Fiber.join);
      assert.isTrue(results.every(Exit.isFailure));
    }).pipe(Effect.scoped),
  );
});
