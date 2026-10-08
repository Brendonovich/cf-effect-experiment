import { expect, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Conversion, Engine, Module, t } from "@macrograph/module";
import { Array, Effect, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("ConversionTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

const intToFloat = Conversion.make({
  from: t.Int,
  to: t.Float,
  convert: (value) => Effect.succeed(value),
});
const intToString = Conversion.make({
  from: t.Int,
  to: t.String,
  convert: (value) => Effect.succeed(String(value)),
});
const failingIntToFloat = Conversion.make({
  from: t.Int,
  to: t.Float,
  convert: (value) => (value === 0 ? Effect.fail("zero") : Effect.succeed(value)),
});

const fixture = (captured: unknown[], eventValue: number) =>
  Module.make({
    id: "conversions",
    engine: TestEngine,
    effect: Effect.fnUntraced(function* (context) {
      yield* context.schema.register({
        id: "event",
        type: "event",
        event: () => Effect.succeed(true),
        io: (io) => ({ out: io.data.out("out", t.Int) }),
        run: ({ io }) => Effect.sync(() => io.out(eventValue)),
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
        ["sinkFloat", t.Float],
        ["sinkString", t.String],
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

const execute = (
  model: ReturnType<typeof project>,
  conversions: Conversion.Registry = Conversion.empty,
  module: ReturnType<typeof fixture>,
) =>
  Effect.gen(function* () {
    const executor = yield* Executor.make(model, { conversions });
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    return yield* Effect.flip(executor.handleEvent(module, new Trigger({})));
  });

it.effect("converts a directional Int to Float wire with a registered conversion", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, 5);
    const model = project(
      [
        ["event", "event"],
        ["sink", "sinkFloat"],
      ],
      [
        ["event", "exec", "sink", "exec"],
        ["event", "out", "sink", "in"],
      ],
    );
    const executor = yield* Executor.make(model, {
      conversions: Conversion.registry([intToFloat]),
    });
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    yield* executor.handleEvent(module, new Trigger({}));
    expect(captured).toEqual([5]);
  }),
);

it.effect("converts Int to String when the consumer registers that rule", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, 5);
    const model = project(
      [
        ["event", "event"],
        ["sink", "sinkString"],
      ],
      [
        ["event", "exec", "sink", "exec"],
        ["event", "out", "sink", "in"],
      ],
    );
    const executor = yield* Executor.make(model, {
      conversions: Conversion.registry([intToString]),
    });
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    yield* executor.handleEvent(module, new Trigger({}));
    expect(captured).toEqual(["5"]);
  }),
);

it.effect("rejects an Int to Float wire when no conversion is registered", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, 5);
    const model = project(
      [
        ["event", "event"],
        ["sink", "sinkFloat"],
      ],
      [
        ["event", "exec", "sink", "exec"],
        ["event", "out", "sink", "in"],
      ],
    );
    const error = yield* execute(model, undefined, module);
    expect(error._tag).toMatch(/InvalidConnection|InvalidGraph/);
    expect(captured).toEqual([]);
  }),
);

it.effect("applies a wildcard resolved to Int when connecting it to a Float input", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, 5);
    const model = project(
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
    );
    const executor = yield* Executor.make(model, {
      conversions: Conversion.registry([intToFloat]),
    });
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    yield* executor.handleEvent(module, new Trigger({}));
    expect(captured).toEqual([5]);
  }),
);

it.effect("lifts a registered scalar conversion through List", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, 5);
    const model = project(
      [
        ["event", "event"],
        ["list", "constIntList"],
        ["sink", "sinkFloatList"],
      ],
      [
        ["event", "exec", "sink", "exec"],
        ["list", "out", "sink", "in"],
      ],
    );
    const executor = yield* Executor.make(model, {
      conversions: Conversion.registry([intToFloat]),
    });
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    yield* executor.handleEvent(module, new Trigger({}));
    expect(captured).toEqual([[1, 2]]);
  }),
);

it.effect("rejects mixed source types feeding one wildcard before execution", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, 5);
    const model = project(
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
    );
    const error = yield* execute(model, Conversion.registry([intToFloat]), module);
    expect(error._tag).toBe("InvalidGraph");
    if (error._tag === "InvalidGraph") expect(error.reasons.join(" ")).toContain("Conflicting");
    expect(captured).toEqual([]);
  }),
);

it.effect("fails the whole run when a registered conversion fails on a value", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, 0);
    const model = project(
      [
        ["event", "event"],
        ["sink", "sinkFloat"],
      ],
      [
        ["event", "exec", "sink", "exec"],
        ["event", "out", "sink", "in"],
      ],
    );
    const error = yield* execute(model, Conversion.registry([failingIntToFloat]), module);
    expect(error._tag).toBe("ConversionFailed");
    expect(captured).toEqual([]);
  }),
);
