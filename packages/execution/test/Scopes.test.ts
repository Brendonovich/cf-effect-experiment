import { describe, expect, it } from "@effect/vitest";
import { Project, Scopes } from "@macrograph/core";
import { DataType, Engine, Module, Registration } from "@macrograph/module";
import { Array, DateTime, Effect, Option, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("ScopeTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
const date = DateTime.makeUnsafe("2026-09-05T12:00:00Z");
const payload = { value: Option.some([date]) };
const fields = { value: DataType.Option(DataType.List(DataType.DateTime)) };

const node = (id: string, packageId: string, schema: string) => ({
  id,
  name: id,
  schema: { package: packageId, schema },
  properties: {},
  inputDefaults: {},
  position: { x: 0, y: 0 },
  foldPins: false,
});
const wire = (
  id: string,
  outNodeId: string,
  outIoId: string,
  inNodeId: string,
  inIoId: string,
) => ({ id, outNodeId, outIo: { _tag: "Port" as const, id: outIoId }, inNodeId, inIoId });

const fixture = (captured: unknown[]) =>
  Module.make({
    id: "scope-test",
    engine: TestEngine,
    effect: Effect.fnUntraced(function* (context) {
      yield* context.schema.register({
        id: "event",
        type: "event",
        event: () => Effect.succeed(true),
        io: (io) => ({ output: io.scope.out("payload", fields) }),
        run: ({ io }) => Effect.succeed(io.output(payload)),
      });
      yield* context.schema.register({
        id: "sink",
        io: (io) => ({ value: io.data.in("value", fields.value) }),
        run: ({ io }) =>
          Effect.sync(() => {
            captured.push(io.value);
          }),
      });
      yield* context.schema.register({
        id: "scopeSink",
        type: "base",
        io: (io) => ({ input: io.scope.in("payload", fields) }),
        run: ({ io }) =>
          Effect.sync(() => {
            // The scope input is materialized with its inferred TypeScript value type.
            const value: Option.Option<ReadonlyArray<DateTime.DateTime>> = io.input.value;
            captured.push(value);
          }),
      });
      yield* context.schema.register({
        id: "wrongSink",
        type: "base",
        io: (io) => ({ input: io.scope.in("payload", { value: DataType.String }) }),
        run: () => Effect.die("Invalid graph must not run"),
      });
    }),
  });

const project = (target = "break") =>
  Schema.decodeUnknownSync(Project.Model)({
    ...Project.empty(),
    graphs: {
      graph: {
        id: "graph",
        name: "Scopes",
        nodes: {
          event: node("event", "scope-test", "event"),
          break: node("break", Scopes.packageId, "BreakScope"),
          sink: node("sink", "scope-test", "sink"),
          scopeSink: node("scopeSink", "scope-test", "scopeSink"),
          wrongSink: node("wrongSink", "scope-test", "wrongSink"),
        },
        connections:
          target === "break"
            ? [
                wire("scope", "event", "payload", "break", "scope"),
                wire("exec", "break", "exec", "sink", "exec"),
                wire("data", "break", "value", "sink", "value"),
              ]
            : [wire("scope", "event", "payload", target, target === "sink" ? "exec" : "payload")],
      },
    },
  });

describe("scope execution", () => {
  it.effect("executes an explicitly empty scope payload", () =>
    Effect.gen(function* () {
      const module = Module.make({
        id: "empty-scope",
        engine: TestEngine,
        effect: (context) =>
          context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: (io) => ({ output: io.scope.out("empty", {}) }),
            run: ({ io }) => Effect.succeed(io.output({})),
          }),
      });
      const model = Schema.decodeUnknownSync(Project.Model)({
        ...Project.empty(),
        graphs: {
          graph: {
            id: "graph",
            name: "Empty scope",
            nodes: {
              event: node("event", module.id, "event"),
              break: node("break", Scopes.packageId, "BreakScope"),
            },
            connections: [wire("scope", "event", "empty", "break", "scope")],
          },
        },
      });
      const ran: string[] = [];
      const executor = yield* Executor.make(model, {
        executionDriver: {
          executeNode: (key, effect) => {
            ran.push(key.nodeId);
            return effect;
          },
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
      expect(ran).toEqual(["event", "break"]);
    }),
  );

  it.effect("validates custom types used only by scope fields before side effects", () =>
    Effect.gen(function* () {
      let ran = false;
      const module = Module.make({
        id: "missing-scope-type",
        engine: TestEngine,
        effect: (context) =>
          context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: (io) => ({
              output: io.scope.out("payload", {
                value: DataType.Custom(DataType.DefinitionId.make("missing")),
              }),
            }),
            run: () =>
              Effect.sync(() => {
                ran = true;
              }),
          }),
      });
      const model = Schema.decodeUnknownSync(Project.Model)({
        ...Project.empty(),
        graphs: {
          graph: {
            id: "graph",
            name: "Missing type",
            nodes: { event: node("event", module.id, "event") },
            connections: [],
          },
        },
      });
      const executor = yield* Executor.make(model);
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      expect(yield* Effect.flip(executor.handleEvent(module, new Trigger({})))).toBeInstanceOf(
        Executor.InvalidGraph,
      );
      expect(ran).toBe(false);
    }),
  );

  it.effect("breaks a scope into typed data and exec, including checkpoint replay", () =>
    Effect.gen(function* () {
      const captured: unknown[] = [];
      const module = fixture(captured);
      const checkpoints = new Map<string, Executor.NodeExecutionResult>();
      const executor = yield* Executor.make(project(), {
        executionDriver: {
          executeNode: (key, run) =>
            key.nodeId === "sink"
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
      expect(captured).toEqual([payload.value, payload.value]);
      expect(checkpoints.get("event")?.scopePayload).toEqual({
        value: { _tag: "Some", value: ["2026-09-05T12:00:00.000Z"] },
      });
    }),
  );

  it.effect("materializes typed scope inputs without a Break Scope node", () =>
    Effect.gen(function* () {
      const captured: unknown[] = [];
      const module = fixture(captured);
      const executor = yield* Executor.make(project("scopeSink"));
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(module, new Trigger({}));
      expect(captured).toEqual([payload.value]);
    }),
  );

  for (const target of ["sink", "wrongSink"]) {
    it.effect(`rejects incompatible ${target} wiring before running nodes`, () =>
      Effect.gen(function* () {
        const module = fixture([]);
        let runs = 0;
        const executor = yield* Executor.make(project(target), {
          executionDriver: {
            executeNode: (_, run) => {
              runs++;
              return run;
            },
          },
        });
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
        expect(runs).toBe(0);
      }),
    );
  }

  for (const scopePayload of [undefined, {}, { value: "wrong" }, { ...payload, extra: true }]) {
    it.effect(
      `rejects missing, invalid or extra checkpoint scope fields: ${JSON.stringify(scopePayload)}`,
      () =>
        Effect.gen(function* () {
          const captured: unknown[] = [];
          const module = fixture(captured);
          const executor = yield* Executor.make(project(), {
            executionDriver: {
              executeNode: () =>
                Effect.succeed({
                  outputs: [],
                  executionOutputId: "payload",
                  ...(scopePayload === undefined ? {} : { scopePayload }),
                }),
            },
          });
          yield* executor.module(
            module,
            Engine.deployment(
              module,
              TestEngine.toLayer(() => Effect.die("Not hosted")),
            ),
          );
          expect(yield* Effect.flip(executor.handleEvent(module, new Trigger({})))).toBeInstanceOf(
            Executor.InvalidOutputValue,
          );
          expect(captured).toEqual([]);
        }),
    );
  }

  it("matches field identity and nominal types, not field ordering or labels", () => {
    expect(
      Registration.scopesCompatible(
        [
          { id: "a", type: DataType.String },
          { id: "b", type: DataType.Int },
        ],
        [
          { id: "b", type: DataType.Int },
          { id: "a", type: DataType.String, name: "Renamed" },
        ],
      ),
    ).toBe(true);
    expect(Registration.scopesCompatible([], null)).toBe(true);
    expect(Registration.scopesCompatible(undefined, null)).toBe(false);
    expect(Registration.scopesCompatible([], undefined)).toBe(false);
  });
});
