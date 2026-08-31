import { assert, describe, it } from "@effect/vitest";
import { Queue } from "@macrograph/core";
import { Effect, Option, Stream } from "effect";

import { QueueRuntime } from "../src/index.ts";

describe("QueueRuntime", () => {
  it.effect("mounts project management without leaking enqueue or captured arguments", () =>
    Effect.gen(function* () {
      const runtime = yield* QueueRuntime.Service;
      const mount = yield* QueueRuntime.Mount;
      assert.deepStrictEqual(yield* runtime.snapshot, []);
      const calls: string[] = [];
      const state: Queue.State = {
        queueId: "work",
        paused: true,
        waiting: [{ id: "item", functionId: "function" }],
        running: [],
      };
      yield* mount.set({
        snapshot: Effect.succeed([state]),
        changes: Stream.make([state]),
        pause: (id, paused) =>
          Effect.sync(() => {
            calls.push(`${id}:${paused}`);
          }),
        advance: (id) =>
          Effect.sync(() => {
            calls.push(`advance:${id}`);
          }),
        remove: (id, item) =>
          Effect.sync(() => {
            calls.push(`remove:${id}:${item}`);
          }),
        clear: (id) =>
          Effect.sync(() => {
            calls.push(`clear:${id}`);
          }),
      });
      assert.deepStrictEqual(yield* runtime.snapshot, [state]);
      assert.deepStrictEqual(Option.getOrThrow(yield* runtime.changes.pipe(Stream.runHead)), [
        state,
      ]);
      yield* runtime.pause("work", false);
      yield* runtime.advance("work");
      yield* runtime.remove("work", "item");
      yield* runtime.clear("work");
      assert.deepStrictEqual(calls, [
        "work:false",
        "advance:work",
        "remove:work:item",
        "clear:work",
      ]);
    }).pipe(Effect.provide(QueueRuntime.layer)),
  );
});
