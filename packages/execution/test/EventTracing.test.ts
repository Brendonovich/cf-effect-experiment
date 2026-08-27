import { assert, describe, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Engine, Plugin } from "@macrograph/plugin";
import { Array, Deferred, Effect, Exit, Fiber, Option, Schema, Tracer } from "effect";

import { Executor } from "../src/index.ts";

class ChatMessage extends Schema.TaggedClass<ChatMessage>()("channel.chat.message", {
  text: Schema.String,
}) {}
class TestEngine extends Engine.make({ events: Array.empty<ChatMessage>() }) {}
const plugin = Plugin.make({ id: "twitch", engine: TestEngine, effect: () => Effect.void });
const deployment = Engine.deployment(
  plugin,
  TestEngine.toLayer(() => Effect.die("not hosted")),
);

const setup = Effect.fnUntraced(function* (registered = true) {
  const spans: Array<Tracer.Span> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const executor = yield* Executor.make(Project.empty(), { projectId: "project-1" });
  if (registered) yield* executor.plugin(plugin, deployment);
  return {
    spans,
    dispatch: executor
      .handleEvent(plugin, new ChatMessage({ text: "private chat content" }))
      .pipe(Effect.provideService(Tracer.Tracer, tracer)),
  };
});

describe("event tracing", () => {
  it.effect("creates a separate root for each event even with no matching graph", () =>
    Effect.gen(function* () {
      const { spans, dispatch } = yield* setup();
      yield* dispatch;
      yield* dispatch;
      assert.lengthOf(spans, 2);
      assert.notStrictEqual(spans[0]!.traceId, spans[1]!.traceId);
      for (const span of spans) {
        assert.strictEqual(span.name, "Executor.handleEvent");
        assert.strictEqual(span.kind, "consumer");
        assert.isTrue(Option.isNone(span.parent));
        assert.deepStrictEqual(Object.fromEntries(span.attributes), {
          "macrograph.project.id": "project-1",
          "macrograph.plugin.id": "twitch",
          "macrograph.event.type": "channel.chat.message",
        });
        assert.strictEqual(span.status._tag, "Ended");
        if (span.status._tag === "Ended") assert.isTrue(Exit.isSuccess(span.status.exit));
      }
    }),
  );

  it.effect("preserves an active parent span", () =>
    Effect.gen(function* () {
      const { spans, dispatch } = yield* setup();
      yield* Effect.gen(function* () {
        const parent = yield* Effect.currentSpan;
        yield* dispatch;
        assert.strictEqual(Option.getOrUndefined(spans[0]!.parent), parent);
        assert.strictEqual(spans[0]!.traceId, parent.traceId);
      }).pipe(Effect.withSpan("incoming-request"));
    }),
  );

  it.effect("preserves propagated external trace context", () =>
    Effect.gen(function* () {
      const { spans, dispatch } = yield* setup();
      const parent = Tracer.externalSpan({ traceId: "a".repeat(32), spanId: "b".repeat(16) });
      yield* dispatch.pipe(Effect.withParentSpan(parent));
      assert.strictEqual(Option.getOrUndefined(spans[0]!.parent), parent);
      assert.strictEqual(spans[0]!.traceId, parent.traceId);
    }),
  );

  it.effect("preserves an ended producer span for deferred work", () =>
    Effect.gen(function* () {
      const { spans, dispatch } = yield* setup();
      const incoming = yield* Deferred.make<void>();
      const { listener, parent } = yield* Effect.gen(function* () {
        const parent = yield* Effect.currentSpan;
        const listener = yield* Deferred.await(incoming).pipe(
          Effect.andThen(dispatch),
          Effect.forkScoped,
        );
        return { listener, parent };
      }).pipe(Effect.withSpan("schedule-event", { kind: "producer" }));
      assert.strictEqual(parent.status._tag, "Ended");
      yield* Deferred.succeed(incoming, undefined);
      yield* Fiber.join(listener);
      assert.lengthOf(spans, 1);
      assert.strictEqual(Option.getOrUndefined(spans[0]!.parent), parent);
      assert.strictEqual(spans[0]!.traceId, parent.traceId);
    }).pipe(Effect.scoped),
  );

  it.effect("ends the event span with dispatch failures", () =>
    Effect.gen(function* () {
      const { spans, dispatch } = yield* setup(false);
      const exit = yield* Effect.exit(dispatch);
      assert.isTrue(Exit.isFailure(exit));
      assert.lengthOf(spans, 1);
      const status = spans[0]!.status;
      assert.strictEqual(status._tag, "Ended");
      if (status._tag === "Ended") assert.isTrue(Exit.isFailure(status.exit));
    }),
  );
});
