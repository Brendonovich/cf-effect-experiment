import { assert, describe, it } from "@effect/vitest";
import { GraphId, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { DataType, Engine, Module, Registration, Retry } from "@macrograph/module";
import { Array, Cause, Effect, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

const modes = ["local", "in-process", "durable", "serialized"] as const;
type Mode = (typeof modes)[number];

const setup = Effect.fnUntraced(function* (
  mode: Mode,
  run: (output: (value: string) => void) => Effect.Effect<void, unknown>,
  retry = false,
  replay?: Registration.Replay,
) {
  const module = Module.make({
    id: "retry",
    engine: TestEngine,
    effect: (registration) =>
      registration.schema.register({
        id: "event",
        type: "event",
        ...(replay === undefined ? {} : { replay }),
        event: () => Effect.succeed(true),
        io: (io) => ({ value: io.data.out("value", DataType.String) }),
        run: ({ io }) => run(io.value),
      }),
  });
  const deployment = Engine.deployment(
    module,
    TestEngine.toLayer(() => Effect.die("not hosted")),
  );
  const graphId = GraphId.make("retry-graph");
  const nodeId = NodeId.make("retry-event");
  const project: Project.Model = {
    ...Project.empty(),
    graphs: {
      [graphId]: {
        canvas: {
          id: graphId,
          name: "Retry",
          nodes: {
            [nodeId]: {
              id: nodeId,
              name: "Event",
              properties: {},
              inputDefaults: {},
              foldPins: false,
              schema: { package: PackageId.make("retry"), schema: SchemaId.make("event") },
              position: { x: 0, y: 0 },
            },
          },
          connections: [],
        },
      },
    },
  };
  const worker = yield* Executor.make(project);
  yield* worker.module(module, deployment);
  const results: Array<Executor.NodeExecutionResult> = [];
  const attempts: Array<Executor.NodeExecutionKey> = [];
  const execute = <A extends Executor.NodeExecutionResult>(
    key: Executor.NodeExecutionKey,
    effect: Effect.Effect<A, Executor.ExecutorError>,
  ) =>
    Effect.sync(() => attempts.push(key)).pipe(
      Effect.andThen(effect),
      Effect.retry({ times: retry ? 1 : 0, while: (error) => error._tag === "Retry" }),
      Effect.tap((result) => Effect.sync(() => results.push(result))),
    );
  const executionEnvironment: Executor.ExecutionEnvironment | undefined =
    mode === "local"
      ? undefined
      : mode === "in-process"
        ? Executor.inProcessExecution((key, executor) => execute(key, executor.executeNode(key)))
        : mode === "durable"
          ? Executor.durableExecution((key, executor) => execute(key, executor.executeNode(key)))
          : {
              _tag: "Serialized",
              executeNode: (request) => execute(request.key, worker.executeSerializedNode(request)),
            };
  const executor = yield* Executor.make(
    project,
    executionEnvironment === undefined ? {} : { executionEnvironment },
  );
  yield* executor.module(module, deployment);
  return { dispatch: executor.handleEvent(module, new Trigger({})), results, attempts };
});

describe("node Retry", () => {
  for (const mode of modes) {
    describe(mode, () => {
      for (const [name, cause] of [
        ["original error", new Error("read timed out", { cause: new Error("socket closed") })],
        ["Effect cause", Cause.combine(Cause.fail("request failed"), Cause.die("cleanup failed"))],
        ["no cause", undefined],
      ] as const) {
        it.effect(`preserves Retry and its ${name} through tag-based handling`, () =>
          Effect.gen(function* () {
            const retry = new Retry({ message: "Safe to repeat this read", cause });
            const { dispatch } = yield* setup(mode, () => retry);
            const caught = yield* dispatch.pipe(Effect.catchTag("Retry", Effect.succeed));
            assert.strictEqual(caught, retry);
            assert.strictEqual(caught?.cause, cause);
            assert.strictEqual(caught?.message, "Safe to repeat this read");
          }),
        );
      }

      for (const [name, cause] of [
        ["ordinary failure", Cause.fail(new Error("permanent failure"))],
        ["Retry used as a defect", Cause.die(new Retry({ cause: new Error("bug") }))],
        ["nested Retry", Cause.fail(new Error("outer failure", { cause: new Retry({}) }))],
        ["mixed failures", Cause.combine(Cause.fail(new Retry({})), Cause.fail("other failure"))],
        ["failure and defect", Cause.combine(Cause.fail(new Retry({})), Cause.die("cleanup"))],
      ] as const) {
        it.effect(`does not grant retry permission for ${name}`, () =>
          Effect.gen(function* () {
            let runs = 0;
            const { dispatch } = yield* setup(
              mode,
              () => {
                runs++;
                return Effect.failCause<unknown>(cause);
              },
              true,
            );
            const result = yield* Effect.result(dispatch);
            assert.strictEqual(runs, 1);
            assert.strictEqual(result._tag, "Failure");
            if (result._tag !== "Failure") return;
            assert.instanceOf(result.failure, Executor.NodeExecutionError);
            if (!(result.failure instanceof Executor.NodeExecutionError)) return;
            assert.strictEqual(result.failure.nodeId, "retry-event");
            assert.isTrue(Cause.isCause(result.failure.cause));
            if (Cause.isCause(result.failure.cause)) {
              assert.lengthOf(result.failure.cause.reasons, cause.reasons.length);
              for (const [index, expected] of cause.reasons.entries()) {
                const actual = result.failure.cause.reasons[index]!;
                assert.strictEqual(actual._tag, expected._tag);
                if (Cause.isFailReason(actual) && Cause.isFailReason<unknown>(expected))
                  assert.strictEqual(actual.error, expected.error);
                if (Cause.isDieReason(actual) && Cause.isDieReason<unknown>(expected))
                  assert.strictEqual(actual.defect, expected.defect);
              }
            }
          }),
        );
      }

      if (mode === "local") return;

      for (const replay of [undefined, "unsafe", "safe"] as const) {
        it.effect(
          `passes ${replay ?? "default"} replay policy without retrying permanent errors`,
          () =>
            Effect.gen(function* () {
              const test = yield* setup(
                mode,
                () => Effect.fail(new Error("permanent failure")),
                true,
                replay,
              );
              const error = yield* Effect.flip(test.dispatch);
              assert.instanceOf(error, Executor.NodeExecutionError);
              assert.lengthOf(test.attempts, 1);
              assert.strictEqual(test.attempts[0]?.replay, replay ?? "unsafe");
            }),
        );
      }

      it.effect("retries the same invocation with fresh outputs under an environment policy", () =>
        Effect.gen(function* () {
          let runs = 0;
          const { dispatch, results, attempts } = yield* setup(
            mode,
            (output) =>
              Effect.gen(function* () {
                runs++;
                output(runs === 1 ? "discard me" : "success");
                if (runs === 1) return yield* new Retry({ cause: new Error("transient") });
              }),
            true,
          );
          yield* dispatch;
          assert.strictEqual(runs, 2);
          assert.lengthOf(attempts, 2);
          assert.strictEqual(attempts[0], attempts[1]);
          assert.deepStrictEqual(results, [
            { outputs: [{ outputId: "value", value: "success" }], executionOutputId: "exec" },
          ]);
        }),
      );

      it.effect("preserves the last original cause when the retry policy is exhausted", () =>
        Effect.gen(function* () {
          const errors = [new Error("first failure"), new Error("last failure")];
          let runs = 0;
          const { dispatch, results } = yield* setup(
            mode,
            () =>
              Effect.fail(errors[runs++]).pipe(Effect.mapError((cause) => new Retry({ cause }))),
            true,
          );
          const caught = yield* dispatch.pipe(Effect.catchTag("Retry", Effect.succeed));
          assert.strictEqual(runs, 2);
          assert.instanceOf(caught, Retry);
          assert.strictEqual(caught?.cause, errors[1]);
          assert.deepStrictEqual(results, []);
        }),
      );
    });
  }
});
