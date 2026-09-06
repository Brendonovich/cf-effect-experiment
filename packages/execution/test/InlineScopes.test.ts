import { describe, expect, it } from "@effect/vitest";
import { Project, OutputRef } from "@macrograph/core";
import { DataType, Engine, Module } from "@macrograph/module";
import { Array, DateTime, Effect, Option, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("InlineScopeTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
const type = DataType.Option(DataType.List(DataType.DateTime));
const value = Option.some([DateTime.makeUnsafe("2026-09-05T12:00:00Z")]);
const node = (id: string, schema = id) => ({
  id,
  name: id,
  schema: { package: "inline", schema },
  properties: {},
  inputDefaults: {},
  foldPins: false,
  position: { x: 0, y: 0 },
});
const wire = (
  id: string,
  source: string,
  outIo: OutputRef.Model,
  target: string,
  input: string,
) => ({ id, outNodeId: source, outIo, inNodeId: target, inIoId: input });
const model = (connections: readonly ReturnType<typeof wire>[]) =>
  Schema.decodeUnknownSync(Project.Model)({
    ...Project.empty(),
    graphs: {
      graph: {
        id: "graph",
        name: "Inline",
        nodes: Object.fromEntries(
          [
            node("event"),
            node("source"),
            node("pure"),
            node("first", "sink"),
            node("second", "sink"),
            node("inner", "source"),
            node("both"),
          ].map((node) => [node.id, node]),
        ),
        connections,
      },
    },
  });
const fixture = (captured: unknown[], runs: string[] = []) =>
  Module.make({
    id: "inline",
    engine: TestEngine,
    effect: Effect.fnUntraced(function* (context) {
      yield* context.schema.register({
        id: "event",
        type: "event",
        event: () => Effect.succeed(true),
        io: () => ({}),
        run: () => Effect.void,
      });
      yield* context.schema.register({
        id: "source",
        type: "base",
        io: (io) => ({
          input: io.exec.in("exec"),
          found: io.scope.out("found", { value: type }),
          empty: io.exec.out("empty"),
        }),
        run: ({ io }) =>
          Effect.sync(() => {
            runs.push("source");
            return io.found({ value });
          }),
      });
      yield* context.schema.register({
        id: "pure",
        type: "pure",
        io: (io) => ({ input: io.data.in("in", type), output: io.data.out("out", type) }),
        run: ({ io }) =>
          Effect.sync(() => {
            runs.push("pure");
            io.output(io.input);
          }),
      });
      yield* context.schema.register({
        id: "sink",
        io: (io) => ({ value: io.data.in("value", type) }),
        run: ({ io }) =>
          Effect.sync(() => {
            captured.push(io.value);
          }),
      });
      yield* context.schema.register({
        id: "both",
        io: (io) => ({ outer: io.data.in("outer", type), inner: io.data.in("inner", type) }),
        run: ({ io }) =>
          Effect.sync(() => {
            captured.push([io.outer, io.inner]);
          }),
      });
    }),
  });
const base = [
  wire("enter", "event", OutputRef.port("exec"), "source", "exec"),
  wire("field", "source", OutputRef.scopeField("found", "value"), "pure", "in"),
  wire("found", "source", OutputRef.scopeExec("found"), "first", "exec"),
  wire("read", "pure", OutputRef.port("out"), "first", "value"),
];

describe("inline scopes", () => {
  it.effect(
    "routes scope exec and typed fields without a Break Scope node, including durable replay",
    () =>
      Effect.gen(function* () {
        const captured: unknown[] = [],
          runs: string[] = [];
        const module = fixture(captured, runs);
        const checkpoints = new Map<string, Executor.NodeExecutionResult>();
        const executor = yield* Executor.make(model(base), {
          executionDriver: {
            executeNode: (key, run) =>
              key.nodeId !== "source"
                ? run
                : checkpoints.has(key.nodeId)
                  ? Effect.succeed(checkpoints.get(key.nodeId)!)
                  : run.pipe(
                      Effect.tap((result) =>
                        Effect.sync(() => {
                          checkpoints.set(key.nodeId, JSON.parse(JSON.stringify(result)));
                        }),
                      ),
                    ),
          },
        });
        yield* executor.module(
          module,
          Engine.deployment(
            module,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        yield* executor.handleEvent(module, new Trigger({}));
        yield* executor.handleEvent(module, new Trigger({}));
        expect(captured).toEqual([value, value]);
        expect(runs).toEqual(["source", "pure", "pure"]);
        expect(checkpoints.get("source")?.scopePayload).toEqual({
          value: { _tag: "Some", value: ["2026-09-05T12:00:00.000Z"] },
        });
      }),
  );

  it.effect(
    "does not leak an activation or a cached pure value into a sibling execution path",
    () =>
      Effect.gen(function* () {
        const captured: unknown[] = [],
          runs: string[] = [];
        const module = fixture(captured, runs);
        const executor = yield* Executor.make(
          model([
            ...base,
            wire("sibling", "event", OutputRef.port("exec"), "second", "exec"),
            wire("sibling-read", "pure", OutputRef.port("out"), "second", "value"),
          ]),
        );
        yield* executor.module(
          module,
          Engine.deployment(
            module,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        const error = yield* Effect.flip(executor.handleEvent(module, new Trigger({})));
        expect(error).toBeInstanceOf(Executor.ScopeNotActive);
        expect(captured).toEqual([value]);
        expect(runs).toEqual(["source", "pure"]);
      }),
  );

  it.effect(
    "does not run a scope producer on demand when its field is read outside the branch",
    () =>
      Effect.gen(function* () {
        const runs: string[] = [],
          captured: unknown[] = [];
        const module = fixture(captured, runs);
        const executor = yield* Executor.make(
          model([
            wire("exec", "event", OutputRef.port("exec"), "first", "exec"),
            wire("field", "source", OutputRef.scopeField("found", "value"), "first", "value"),
          ]),
        );
        yield* executor.module(
          module,
          Engine.deployment(
            module,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        expect(yield* Effect.flip(executor.handleEvent(module, new Trigger({})))).toBeInstanceOf(
          Executor.ScopeNotActive,
        );
        expect(runs).toEqual([]);
        expect(captured).toEqual([]);
      }),
  );

  it.effect("retains outer scope values inside a nested scope activation", () =>
    Effect.gen(function* () {
      const captured: unknown[] = [];
      const module = fixture(captured);
      const executor = yield* Executor.make(
        model([
          wire("event", "event", OutputRef.port("exec"), "source", "exec"),
          wire("outer", "source", OutputRef.scopeExec("found"), "inner", "exec"),
          wire("inner", "inner", OutputRef.scopeExec("found"), "both", "exec"),
          wire("outer-value", "source", OutputRef.scopeField("found", "value"), "both", "outer"),
          wire("inner-value", "inner", OutputRef.scopeField("found", "value"), "both", "inner"),
        ]),
      );
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(module, new Trigger({}));
      expect(captured).toEqual([[value, value]]);
    }),
  );

  for (const ref of [
    OutputRef.scopeField("found", "gone"),
    OutputRef.scopeField("empty", "value"),
    OutputRef.scopeExec("missing"),
  ]) {
    it.effect(`rejects invalid projection ${OutputRef.key(ref)} before execution`, () =>
      Effect.gen(function* () {
        const runs: string[] = [];
        const module = fixture([], runs);
        const executor = yield* Executor.make(
          model(base.map((edge) => (edge.id === "field" ? { ...edge, outIo: ref } : edge))),
        );
        yield* executor.module(
          module,
          Engine.deployment(
            module,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        expect(yield* Effect.flip(executor.handleEvent(module, new Trigger({})))).toBeInstanceOf(
          Executor.InvalidConnection,
        );
        expect(runs).toEqual([]);
      }),
    );
  }
});
