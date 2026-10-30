import { expect, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Conversion, Engine, Module, t } from "@macrograph/module";
import { Array, Cause, Effect, Exit, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("ConversionTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

const Code = t.defineStruct("conversions/Code", "Code", { value: t.Int });
const codeValue = (value: number) => ({ value, _type: Code.id });

const fixture = (captured: unknown[], eventValue: number) =>
  Module.make({
    id: "conversions",
    engine: TestEngine,
    types: { [Code.id]: Code },
    effect: Effect.fnUntraced(function* (context) {
      yield* context.conversion.register(
        Conversion.make({
          from: t.Struct(Code),
          to: t.Int,
          convert: (code) =>
            code.value === 0 ? Effect.fail("zero") : Effect.succeed(Number(code.value)),
        }),
      );
      yield* context.schema.register({
        id: "event",
        type: "event",
        event: () => Effect.succeed(true),
        io: (io) => ({
          out: io.data.out("out", t.Int),
          code: io.data.out("code", t.Struct(Code)),
        }),
        run: ({ io }) =>
          Effect.sync(() => {
            io.out(eventValue);
            io.code(codeValue(eventValue));
          }),
      });
      yield* context.schema.register({
        id: "constIntList",
        type: "pure",
        io: (io) => ({ out: io.data.out("out", t.List(t.Int)) }),
        run: ({ io }) => Effect.sync(() => io.out([1, 2])),
      });
      yield* context.schema.register({
        id: "constFloatList",
        type: "pure",
        io: (io) => ({ out: io.data.out("out", t.List(t.Float)) }),
        run: ({ io }) => Effect.sync(() => io.out([1.5])),
      });
      yield* context.schema.register({
        id: "identity",
        type: "pure",
        io: (io) => {
          const wildcard = io.wildcard("T");
          return { in: io.data.in("in", wildcard), out: io.data.out("out", wildcard) };
        },
        run: ({ io }) => Effect.sync(() => io.out(io.in)),
      });
      yield* context.schema.register({
        id: "append",
        type: "pure",
        io: (io) => {
          const wildcard = io.wildcard("T");
          return {
            item: io.data.in("item", wildcard),
            list: io.data.in("list", t.List(wildcard)),
            out: io.data.out("out", t.List(wildcard)),
          };
        },
        run: ({ io }) => Effect.sync(() => io.out([...io.list, io.item])),
      });
      for (const [id, type] of [
        ["sinkInt", t.Int],
        ["sinkFloat", t.Float],
        ["sinkString", t.String],
        ["sinkBool", t.Bool],
        ["sinkFloatList", t.List(t.Float)],
      ] as const)
        yield* context.schema.register({
          id,
          type: "exec",
          io: (io) => ({ in: io.data.in("in", type) }),
          run: ({ io }) =>
            Effect.sync(() => {
              captured.push(io.in);
            }),
        });
    }),
  });

const node = (id: string, schema: string) => ({
  id,
  name: id,
  schema: { package: "conversions", schema },
  properties: {},
  inputDefaults: {},
  position: { x: 0, y: 0 },
  foldPins: false,
});

const project = (
  nodes: ReadonlyArray<readonly [string, string]>,
  wires: ReadonlyArray<readonly [string, string, string, string]>,
) =>
  Schema.decodeUnknownSync(Project.Model)({
    ...Project.empty(),
    graphs: {
      graph: {
        canvas: {
          id: "graph",
          name: "Graph",
          nodes: Object.fromEntries(nodes.map(([id, schema]) => [id, node(id, schema)])),
          connections: wires.map(([from, out, to, input], i) => ({
            id: String(i),
            outNodeId: from,
            outIo: { _tag: "Port", id: out },
            inNodeId: to,
            inIoId: input,
          })),
        },
      },
    },
  });

const run = (model: ReturnType<typeof project>, captured: unknown[], eventValue = 5) =>
  Effect.gen(function* () {
    const module = fixture(captured, eventValue);
    const executor = yield* Executor.make(model);
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    return yield* Effect.exit(executor.handleEvent(module, new Trigger({})));
  });

const failure = (exit: Exit.Exit<void, Executor.ExecutorError>) =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined;

const sinkGraph = (sink: string, output = "out") =>
  project(
    [
      ["event", "event"],
      ["sink", sink],
    ],
    [
      ["event", "exec", "sink", "exec"],
      ["event", output, "sink", "in"],
    ],
  );

it.effect("applies the core Int to Float and Int to String conversions by default", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    expect(Exit.isSuccess(yield* run(sinkGraph("sinkFloat"), captured))).toBe(true);
    expect(Exit.isSuccess(yield* run(sinkGraph("sinkString"), captured))).toBe(true);
    expect(captured).toEqual([5, "5"]);
  }),
);

it.effect("rejects a connection with no conversion in that direction", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const exit = yield* run(sinkGraph("sinkBool"), captured);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(captured).toEqual([]);
  }),
);

it.effect("applies a module-registered conversion from a type the module declares", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    expect(Exit.isSuccess(yield* run(sinkGraph("sinkInt", "code"), captured))).toBe(true);
    expect(captured).toEqual([5]);
  }),
);

it.effect("fails the whole run when a conversion fails on a value", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const exit = yield* run(sinkGraph("sinkInt", "code"), captured, 0);
    const error = failure(exit);
    expect(error?._tag === "Some" ? error.value._tag : undefined).toBe("ConversionFailed");
    expect(captured).toEqual([]);
  }),
);

it.effect("converts a wildcard resolved to Int when it feeds a Float input", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const exit = yield* run(
      project(
        [
          ["event", "event"],
          ["identity", "identity"],
          ["sink", "sinkFloat"],
        ],
        [
          ["event", "exec", "sink", "exec"],
          ["event", "out", "identity", "in"],
          ["identity", "out", "sink", "in"],
        ],
      ),
      captured,
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(captured).toEqual([5]);
  }),
);

it.effect("lifts a scalar conversion through List", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const exit = yield* run(
      project(
        [
          ["event", "event"],
          ["list", "constIntList"],
          ["sink", "sinkFloatList"],
        ],
        [
          ["event", "exec", "sink", "exec"],
          ["list", "out", "sink", "in"],
        ],
      ),
      captured,
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(captured).toEqual([[1, 2]]);
  }),
);

it.effect("rejects mixed source types feeding one wildcard before execution", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const exit = yield* run(
      project(
        [
          ["event", "event"],
          ["list", "constFloatList"],
          ["append", "append"],
          ["sink", "sinkFloatList"],
        ],
        [
          ["event", "exec", "sink", "exec"],
          ["event", "out", "append", "item"],
          ["list", "out", "append", "list"],
          ["append", "out", "sink", "in"],
        ],
      ),
      captured,
    );
    const error = failure(exit);
    expect(error?._tag === "Some" ? error.value._tag : undefined).toBe("InvalidGraph");
    expect(captured).toEqual([]);
  }),
);

const mountDefect = (...modules: ReadonlyArray<Module.Module>) =>
  Effect.gen(function* () {
    const executor = yield* Executor.make(Project.empty());
    const exit = yield* Effect.exit(
      Effect.forEach(modules, (module) => executor.module(module), { discard: true }),
    );
    return Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : undefined;
  });

it.effect(
  "fails to mount a module registering a conversion between types it does not declare",
  () =>
    Effect.gen(function* () {
      const defect = yield* mountDefect(
        Module.make({
          id: "orphan",
          effect: (context) =>
            context.conversion.register(
              Conversion.make({
                from: t.Int,
                to: t.Bool,
                convert: (value) => Effect.succeed(value > 0),
              }),
            ),
        }),
      );
      expect(defect).toContain("without declaring either type");
    }),
);

it.effect("fails to mount a module declaring a type outside its namespace", () =>
  Effect.gen(function* () {
    const Loose = t.defineStruct("Loose", "Loose", {});
    const defect = yield* mountDefect(
      Module.make({ id: "loose", types: { [Loose.id]: Loose }, effect: () => Effect.void }),
    );
    expect(defect).toContain("outside its namespace loose/");
  }),
);

it.effect("fails to mount a second module registering the same conversion", () =>
  Effect.gen(function* () {
    const A = t.defineStruct("a/A", "A", {});
    const B = t.defineStruct("b/B", "B", {});
    const register = (id: string, owned: t.StructDefinition) =>
      Module.make({
        id,
        types: { [owned.id]: owned },
        effect: (context) =>
          context.conversion.register(
            Conversion.make({
              from: t.Struct(A),
              to: t.Struct(B),
              convert: () => Effect.succeed({ _type: B.id }),
            }),
          ),
      });
    const defect = yield* mountDefect(register("a", A), register("b", B));
    expect(defect).toContain("registered by both a and b");
  }),
);
