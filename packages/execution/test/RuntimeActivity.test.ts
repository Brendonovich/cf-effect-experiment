import { assert, describe, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Engine, Plugin } from "@macrograph/plugin";
import {
  Array as EffectArray,
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { Executor, RuntimeActivity } from "../src/index.ts";

const key = (id: string): Executor.NodeExecutionKey => ({
  projectId: "project",
  graphId: "graph",
  eventNodeId: "event-node",
  nodeId: `node-${id}`,
  kind: "exec",
  executionPath: `event:event-node/exec:${id}`,
  executionTraceId: `execution-${id}`,
  traceId: id,
});
const result: Executor.NodeExecutionResult = { outputs: [], executionOutputId: null };

class Message extends Schema.TaggedClass<Message>()("Message", {
  message: Schema.String,
  values: Schema.Array(Schema.Number),
}) {}
class TestEngine extends Engine.make({ events: EffectArray.empty<Message>() }) {}
const plugin = Plugin.make({ id: "replay-test", engine: TestEngine, effect: () => Effect.void });

describe("RuntimeActivity", () => {
  it.effect("replays the full original input with fresh IDs and the current executor", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const event = new Message({
        message: "x".repeat(20_000),
        values: EffectArray.range(0, 100),
      });
      let version = 0;
      const calls: number[] = [];
      const executor = activity.wrap({
        ...(yield* Executor.make(Project.empty())),
        handleEvent: (definition, input) => {
          const currentVersion = version;
          return Effect.sync(() => {
            assert.isTrue(Object.is(definition, plugin));
            assert.strictEqual(input, event);
            assert.instanceOf(input, Message);
            calls.push(currentVersion);
          });
        },
      });
      yield* executor.handleEvent(plugin, event);
      const original = (yield* activity.snapshot)[0]!;
      assert.strictEqual(original.source, "Engine");
      assert.isTrue(original.replayable);
      assert.notStrictEqual(original.payload, JSON.stringify(event));
      assert.isAtMost(original.payload.length, RuntimeActivity.limits.payload);

      let previous = original;
      for (version = 1; version <= 2; version++) {
        assert.isUndefined(yield* activity.replay(previous.id));
        const events = Option.getOrThrow(
          yield* activity.changes.pipe(
            Stream.filter(
              (events) => events[0]?.id !== previous.id && events[0]?.status === "complete",
            ),
            Stream.runHead,
          ),
        );
        const replayed = events[0]!;
        assert.strictEqual(replayed.source, "Replay");
        assert.isTrue(replayed.replayable);
        assert.strictEqual(replayed.pluginId, original.pluginId);
        assert.strictEqual(replayed.name, original.name);
        assert.strictEqual(replayed.payload, original.payload);
        assert.strictEqual(new Set(events.map((event) => event.id)).size, version + 1);
        assert.isNotNull(replayed.finishedAt);
        assert.isNull(replayed.error);
        previous = replayed;
      }
      assert.deepStrictEqual(calls, [0, 1, 2]);
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect(
    "queues replay RPCs beyond the request lifetime and records asynchronous failures",
    () =>
      Effect.gen(function* () {
        const activity = yield* RuntimeActivity.Service;
        const client = yield* RpcTest.makeClient(RuntimeActivity.Rpcs);
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let nodeEffect: Effect.Effect<Executor.NodeExecutionResult, Executor.ExecutorError> =
          Effect.succeed(result);
        const executor = activity.wrap({
          ...(yield* Executor.make(Project.empty())),
          handleEvent: () =>
            activity.executionDriver.executeNode(key("queued"), nodeEffect).pipe(Effect.asVoid),
        });
        yield* executor.handleEvent(plugin, new Message({ message: "queued", values: [] }));
        const original = (yield* activity.snapshot)[0]!;
        nodeEffect = Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(
            Effect.fail(
              new Executor.NodeExecutionError({
                nodeId: "queued",
                cause: new Error("replay failed"),
              }),
            ),
          ),
        );
        assert.isUndefined(
          yield* client
            .ReplayEvent({ eventId: original.id })
            .pipe(Effect.forkChild, Effect.flatMap(Fiber.join)),
        );
        yield* Deferred.await(started);
        const running = (yield* activity.snapshot)[0]!;
        assert.notStrictEqual(running.id, original.id);
        assert.strictEqual(running.source, "Replay");
        assert.isTrue(running.replayable);
        assert.strictEqual(running.status, "running");
        assert.isNull(running.finishedAt);
        assert.strictEqual(running.nodes[0]?.status, "running");

        yield* Deferred.succeed(release, undefined);
        const failed = Option.getOrThrow(
          yield* client.ActivityStream().pipe(
            Stream.filter((events) => events[0]?.status === "failed"),
            Stream.runHead,
          ),
        )[0]!;
        assert.strictEqual(failed.id, running.id);
        assert.include(failed.error!, "replay failed");
        assert.isNotNull(failed.finishedAt);
        assert.strictEqual(failed.nodes[0]?.status, "failed");
        assert.isNotNull(failed.nodes[0]?.finishedAt);
        assert.strictEqual((yield* activity.snapshot)[1]?.status, "complete");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          RuntimeActivity.handlerLayer.pipe(Layer.provideMerge(RuntimeActivity.layer)),
        ),
      ),
  );

  it.effect("rejects missing, non-replayable, and evicted events without executing them", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      let calls = 0;
      const executor = activity.wrap({
        ...(yield* Executor.make(Project.empty())),
        handleEvent: () =>
          Effect.sync(() => {
            calls++;
          }),
      });
      yield* executor.handleEvent(plugin, new Message({ message: "old", values: [] }));
      const evictedId = (yield* activity.snapshot)[0]!.id;
      for (let index = 0; index < RuntimeActivity.limits.events; index++)
        yield* activity.track("test", { _tag: String(index) }, Effect.void);
      const events = yield* activity.snapshot;
      assert.lengthOf(events, RuntimeActivity.limits.events);
      assert.isFalse(events.some((event) => event.id === evictedId));
      assert.isFalse(events[0]!.replayable);
      for (const eventId of ["missing", events[0]!.id, evictedId]) {
        const replayed = yield* activity.replay(eventId).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(replayed));
        if (Exit.isFailure(replayed))
          assert.deepStrictEqual(
            Cause.squash(replayed.cause),
            new RuntimeActivity.ReplayUnavailable({ eventId }),
          );
      }
      yield* Effect.yieldNow;
      assert.strictEqual(calls, 1);
      assert.strictEqual(yield* activity.snapshot, events);
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect("captures event and node success without changing their result", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const startedAt = yield* Clock.currentTimeMillis;
      const event = { _tag: "Message", message: "hello", values: [1, true, null] };
      const value = yield* activity.track(
        "test",
        event,
        activity.executionDriver.executeNode(key("one"), Effect.succeed(result)),
      );
      assert.strictEqual(value, result);
      const events = yield* activity.snapshot;
      assert.lengthOf(events, 1);
      const captured = events[0]!;
      assert.strictEqual(captured.pluginId, "test");
      assert.strictEqual(captured.name, "Message");
      assert.strictEqual(captured.startedAt, startedAt);
      assert.strictEqual(captured.finishedAt, yield* Clock.currentTimeMillis);
      assert.strictEqual(captured.status, "complete");
      assert.isNull(captured.error);
      assert.deepStrictEqual(JSON.parse(captured.payload), event);
      assert.deepStrictEqual(captured.nodes, [
        {
          id: "one",
          graphId: "graph",
          nodeId: "node-one",
          executionId: "execution-one",
          startedAt,
          finishedAt: captured.finishedAt,
          status: "complete",
          error: null,
        },
      ]);
      assert.deepStrictEqual(
        Schema.decodeUnknownSync(Schema.Array(RuntimeActivity.Event))(events),
        events,
      );
      yield* activity.executionDriver.executeNode(key("untracked"), Effect.succeed(result));
      assert.strictEqual(yield* activity.snapshot, events);
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect("preserves failures and defects while recording bounded errors", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const error = new Executor.NodeExecutionError({ nodeId: "one", cause: new Error("broken") });
      const failed = yield* activity
        .track(
          "test",
          { _tag: "Failure" },
          activity.executionDriver.executeNode(key("one"), Effect.fail(error)),
        )
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(failed));
      if (Exit.isFailure(failed)) assert.strictEqual(Cause.squash(failed.cause), error);
      const event = (yield* activity.snapshot)[0]!;
      assert.strictEqual(event.status, "failed");
      assert.strictEqual(event.nodes[0]?.status, "failed");
      assert.include(event.error!, "broken");
      assert.isAtMost(event.error!.length, RuntimeActivity.limits.error);
      assert.isAtMost(event.nodes[0]!.error!.length, RuntimeActivity.limits.error);

      const defect = { message: "x".repeat(100_000) };
      const died = yield* activity
        .track("test", { _tag: "Defect" }, Effect.die(defect))
        .pipe(Effect.exit);
      assert.isTrue(Exit.hasDies(died));
      if (Exit.isFailure(died)) assert.strictEqual(Cause.squash(died.cause), defect);
      assert.strictEqual((yield* activity.snapshot)[0]?.status, "failed");
      assert.isAtMost((yield* activity.snapshot)[0]!.error!.length, RuntimeActivity.limits.error);
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect("records interruption and finalizes both event and node", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const started = yield* Deferred.make<void>();
      const fiber = yield* activity
        .track(
          "test",
          { _tag: "Wait" },
          activity.executionDriver.executeNode(
            key("wait"),
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const running = (yield* activity.snapshot)[0]!;
      assert.strictEqual(running.status, "running");
      assert.isNull(running.finishedAt);
      assert.strictEqual(running.nodes[0]?.status, "running");
      yield* Fiber.interrupt(fiber);
      assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(fiber)));
      const interrupted = (yield* activity.snapshot)[0]!;
      assert.strictEqual(interrupted.status, "interrupted");
      assert.strictEqual(interrupted.nodes[0]?.status, "interrupted");
      assert.isNotNull(interrupted.finishedAt);
      assert.isNotNull(interrupted.nodes[0]?.finishedAt);
      // Published snapshots remain immutable after completion.
      assert.strictEqual(running.status, "running");
      assert.strictEqual(running.nodes[0]?.status, "running");
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect("associates concurrent child-fiber nodes with their own event", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const release = yield* Deferred.make<void>();
      const started = yield* Effect.forEach(["a", "b"], () => Deferred.make<void>());
      const fibers = yield* Effect.forEach(["a", "b"], (id, index) =>
        activity
          .track(
            "test",
            { _tag: id },
            activity.executionDriver
              .executeNode(
                key(id),
                Deferred.succeed(started[index]!, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as(result),
                ),
              )
              .pipe(Effect.forkChild, Effect.flatMap(Fiber.join)),
          )
          .pipe(Effect.forkChild),
      );
      yield* Effect.forEach(started, Deferred.await);
      const running = yield* activity.snapshot;
      assert.lengthOf(running, 2);
      for (const event of running) {
        assert.strictEqual(event.status, "running");
        assert.lengthOf(event.nodes, 1);
        assert.strictEqual(event.nodes[0]?.id, event.name);
        assert.strictEqual(event.nodes[0]?.executionId, `execution-${event.name}`);
      }
      yield* Deferred.succeed(release, undefined);
      yield* Effect.forEach(fibers, Fiber.join);
      for (const event of yield* activity.snapshot) {
        assert.strictEqual(event.status, "complete");
        assert.strictEqual(event.nodes[0]?.status, "complete");
      }
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect("bounds history and node retention without resurrecting evicted events", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const release = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const old = yield* activity
        .track(
          "test",
          { _tag: "old" },
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      for (let index = 0; index < RuntimeActivity.limits.events + 10; index++)
        yield* activity.track("test", { _tag: String(index) }, Effect.void);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(old);
      let events = yield* activity.snapshot;
      assert.lengthOf(events, RuntimeActivity.limits.events);
      assert.strictEqual(events[0]?.name, "109");
      assert.strictEqual(events.at(-1)?.name, "10");
      yield* activity.track(
        "test",
        { _tag: "many nodes" },
        Effect.gen(function* () {
          for (let index = 0; index < RuntimeActivity.limits.nodes + 10; index++)
            yield* activity.executionDriver.executeNode(key(String(index)), Effect.succeed(result));
        }),
      );
      events = yield* activity.snapshot;
      assert.lengthOf(events, RuntimeActivity.limits.events);
      assert.lengthOf(events[0]!.nodes, RuntimeActivity.limits.nodes);
      assert.strictEqual(events[0]!.nodes[0]?.id, "10");
      assert.strictEqual(events[0]!.nodes.at(-1)?.id, "209");
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect("safely displays cyclic, oversized, and hostile payloads", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const cyclic: Record<string, unknown> = { big: 123n };
      cyclic.self = cyclic;
      Object.defineProperty(cyclic, "secret", {
        get: () => {
          throw new Error("getter invoked");
        },
      });
      const event = {
        _tag: "Safe",
        cyclic,
        toJSON: () => {
          throw new Error("toJSON invoked");
        },
      };
      yield* activity.track("test", event, Effect.void);
      const payload = (yield* activity.snapshot)[0]!.payload;
      assert.include(payload, "[circular]");
      assert.include(payload, "[getter]");
      assert.include(payload, '"123"');
      assert.doesNotThrow(() => JSON.parse(payload));

      yield* activity.track(
        "test",
        {
          _tag: "Large",
          ...Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [index, "\u0000".repeat(100_000)]),
          ),
        },
        Effect.void,
      );
      const large = (yield* activity.snapshot)[0]!.payload;
      assert.isAtMost(large.length, RuntimeActivity.limits.payload);
      assert.doesNotThrow(() => JSON.parse(large));

      const hostile = new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error("proxy invoked");
          },
        },
      );
      yield* activity.track("test", { _tag: "Hostile", hostile }, Effect.succeed(42));
      assert.strictEqual((yield* activity.snapshot)[0]?.status, "complete");
      assert.strictEqual((yield* activity.snapshot)[0]?.payload, '"[unserializable]"');
    }).pipe(Effect.provide(RuntimeActivity.layer)),
  );

  it.effect(
    "replays the latest snapshot and coalesces slow consumers without blocking execution",
    () =>
      Effect.gen(function* () {
        const activity = yield* RuntimeActivity.Service;
        const pull = yield* Stream.toPull(activity.changes);
        assert.deepStrictEqual(yield* pull, [[]]);
        for (let index = 0; index < 20; index++)
          yield* activity.track("test", { _tag: String(index) }, Effect.void);
        const latest = yield* activity.snapshot;
        assert.deepStrictEqual(yield* pull, [latest]);
        const reconnected = yield* Stream.runHead(activity.changes);
        assert.deepStrictEqual(Option.getOrThrow(reconnected), latest);
      }).pipe(Effect.scoped, Effect.provide(RuntimeActivity.layer)),
  );

  it.effect("streams running and completed snapshots through the runtime RPC group", () =>
    Effect.gen(function* () {
      const activity = yield* RuntimeActivity.Service;
      const client = yield* RpcTest.makeClient(RuntimeActivity.Rpcs);
      assert.deepStrictEqual(
        Option.getOrThrow(yield* client.ActivityStream().pipe(Stream.runHead)),
        [],
      );
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const fiber = yield* activity
        .track(
          "rpc",
          { _tag: "Running" },
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const pull = yield* Stream.toPull(client.ActivityStream());
      assert.strictEqual((yield* pull)[0]?.[0]?.status, "running");
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fiber);
      assert.strictEqual((yield* pull)[0]?.[0]?.status, "complete");
    }).pipe(
      Effect.scoped,
      Effect.provide(RuntimeActivity.handlerLayer.pipe(Layer.provideMerge(RuntimeActivity.layer))),
    ),
  );
});
