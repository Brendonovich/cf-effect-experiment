import { assert, describe, it } from "@effect/vitest";
import { GraphId, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { DataType, Engine, Plugin } from "@macrograph/plugin";
import { Array, Cause, Deferred, Effect, Exit, Fiber, Option, Schema, Tracer } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

const graphId = GraphId.make("tracing-graph");
const nodeId = NodeId.make("tracing-event");
const executionSpanNames = [
  "Executor.handleEvent",
  "Executor.executeEventNode",
  "Executor.runNode",
];

const setup = Effect.fnUntraced(function* (
  run: Effect.Effect<void, unknown> | (() => Effect.Effect<void, unknown>),
  missingInput = false,
) {
  const plugin = Plugin.make({
    id: "tracing",
    engine: TestEngine,
    effect: (registration) =>
      registration.schema.register({
        id: "event",
        type: "event",
        event: () => Effect.succeed(true),
        io: (io) => (missingInput ? { value: io.data.in("value", DataType.String) } : {}),
        run: typeof run === "function" ? run : () => run,
      }),
  });
  const deployment = Engine.deployment(
    plugin,
    TestEngine.toLayer(() => Effect.die("not hosted")),
  );
  const project: Project.Model = {
    ...Project.empty(),
    graphs: {
      [graphId]: {
        id: graphId,
        name: "Tracing",
        nodes: {
          [nodeId]: {
            id: nodeId,
            name: "Event",
            properties: {},
            inputDefaults: {},
            foldPins: false,
            schema: { package: PackageId.make("tracing"), schema: SchemaId.make("event") },
            position: { x: 0, y: 0 },
          },
        },
        connections: [],
      },
    },
  };
  const executor = yield* Executor.make(project, { projectId: "project-1" });
  yield* executor.plugin(plugin, deployment);
  const spans: Array<Tracer.Span> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return {
    spans,
    dispatch: executor
      .handleEvent(plugin, new Trigger({}))
      .pipe(Effect.provideService(Tracer.Tracer, tracer)),
  };
});

const assertSpanExit = (
  spans: ReadonlyArray<Tracer.Span>,
  name: string,
  exit: Exit.Exit<unknown, unknown>,
) => {
  const matching = spans.filter((span) => span.name === name);
  assert.lengthOf(matching, 1, name);
  const span = matching[0]!;
  assert.strictEqual(span.status._tag, "Ended", name);
  if (span.status._tag === "Ended") {
    assert.isTrue(Exit.isFailure(span.status.exit), name);
    if (Exit.isFailure(span.status.exit) && Exit.isFailure(exit)) {
      if (Cause.hasInterrupts(exit.cause)) {
        assert.isTrue(Cause.hasInterruptsOnly(span.status.exit.cause), name);
      } else {
        assert.strictEqual(Cause.squash(span.status.exit.cause), Cause.squash(exit.cause), name);
      }
    }
  }
  return span;
};

describe("execution tracing", () => {
  it.effect("closes node, graph, and event spans with the node failure", () =>
    Effect.gen(function* () {
      const { spans, dispatch } = yield* setup(Effect.fail("node failed"));
      const exit = yield* Effect.exit(dispatch);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, Executor.NodeExecutionError);
        if (error instanceof Executor.NodeExecutionError) assert.strictEqual(error.nodeId, nodeId);
      }
      const [eventSpan, graphSpan, nodeSpan] = executionSpanNames.map((name) =>
        assertSpanExit(spans, name, exit),
      );
      assert.isTrue(Option.isNone(eventSpan!.parent));
      assert.strictEqual(Option.getOrUndefined(graphSpan!.parent), eventSpan);
      assert.strictEqual(Option.getOrUndefined(nodeSpan!.parent), graphSpan);
      assert.strictEqual(nodeSpan!.traceId, eventSpan!.traceId);
      const schemaSpan = spans.find((span) => span.name === "Schema.run tracing.event")!;
      assert.strictEqual(Option.getOrUndefined(schemaSpan.parent), nodeSpan);
      assert.strictEqual(schemaSpan.status._tag, "Ended");
      if (schemaSpan.status._tag === "Ended" && Exit.isFailure(schemaSpan.status.exit)) {
        assert.strictEqual(Cause.squash(schemaSpan.status.exit.cause), "node failed");
      } else assert.fail("Schema span must record the original failure");
      const matchSpan = spans.find((span) => span.name === "Executor.matchEvent");
      assert.isDefined(matchSpan);
      assert.strictEqual(Option.getOrUndefined(matchSpan!.parent), eventSpan);
      assert.strictEqual(matchSpan!.status._tag, "Ended");
      if (matchSpan!.status._tag === "Ended") assert.isTrue(Exit.isSuccess(matchSpan!.status.exit));
    }),
  );

  it.effect("closes running node, graph, and event spans with interruption", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const { spans, dispatch } = yield* setup(
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const fiber = yield* dispatch.pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      for (const name of executionSpanNames) {
        const span = spans.find((span) => span.name === name);
        assert.isDefined(span, name);
        assert.strictEqual(span!.status._tag, "Started", name);
      }
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.hasInterrupts(exit));
      for (const name of executionSpanNames) assertSpanExit(spans, name, exit);
      assertSpanExit(spans, "Schema.run tracing.event", exit);
    }).pipe(Effect.scoped),
  );

  it.effect("captures synchronous callback defects in the schema span", () =>
    Effect.gen(function* () {
      const defect = new Error("schema callback failed");
      const { spans, dispatch } = yield* setup(() => {
        throw defect;
      });
      const exit = yield* Effect.exit(dispatch);
      assert.isTrue(Exit.isFailure(exit));
      for (const name of executionSpanNames) assertSpanExit(spans, name, exit);
      const schemaSpan = spans.find((span) => span.name === "Schema.run tracing.event")!;
      assert.strictEqual(schemaSpan.status._tag, "Ended");
      if (schemaSpan.status._tag === "Ended" && Exit.isFailure(schemaSpan.status.exit)) {
        assert.isTrue(Cause.hasDies(schemaSpan.status.exit.cause));
        assert.strictEqual(Cause.squash(schemaSpan.status.exit.cause), defect);
      } else assert.fail("Schema span must record the synchronous defect");
    }),
  );

  it.effect("captures missing-input failure in the input and consuming node spans", () =>
    Effect.gen(function* () {
      const { spans, dispatch } = yield* setup(Effect.die("run must not be reached"), true);
      const exit = yield* Effect.exit(dispatch);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.deepStrictEqual(
          Cause.squash(exit.cause),
          new Executor.MissingInput({ nodeId, inputId: "value" }),
        );
      }
      for (const name of executionSpanNames) assertSpanExit(spans, name, exit);
      const inputSpan = assertSpanExit(spans, "Executor.resolveInput", exit);
      const nodeSpan = spans.find((span) => span.name === "Executor.runNode");
      assert.strictEqual(Option.getOrUndefined(inputSpan.parent), nodeSpan);
      assert.strictEqual(inputSpan.traceId, nodeSpan!.traceId);
      assert.isFalse(spans.some((span) => span.name.startsWith("Schema.run ")));
    }),
  );
});
