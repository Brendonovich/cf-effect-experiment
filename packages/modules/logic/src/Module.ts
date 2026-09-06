import { DataType } from "@macrograph/module/DataType";
import * as Module from "@macrograph/module/Module";
import { Effect, Option } from "effect";

const validCount = (count: number) => Number.isSafeInteger(count) && count >= 0 && count <= 1024;

const LogicModule = Module.make({
  id: "logic",
  name: "Logic",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "Branch",
      name: "Branch",
      type: "base",
      description: "Routes execution to exactly one boolean branch.",
      io: (io) => ({
        exec: io.exec.in("exec"),
        condition: io.data.in("condition", DataType.Bool, {
          name: "Condition",
          defaultValue: false,
        }),
        whenTrue: io.exec.out("true", { name: "True" }),
        whenFalse: io.exec.out("false", { name: "False" }),
      }),
      run: ({ io }) => Effect.succeed(io.condition ? io.whenTrue : io.whenFalse),
    });
    yield* context.schema.register({
      id: "Wait",
      name: "Wait",
      description:
        "Waits an interruptible, nonnegative whole number of milliseconds (at most 2147483647).",
      io: (io) => ({
        delay: io.data.in("delay", DataType.Int, { name: "Wait in ms", defaultValue: 0 }),
      }),
      run: ({ io }) =>
        Number.isSafeInteger(io.delay) && io.delay >= 0 && io.delay <= 2147483647
          ? Effect.sleep(io.delay)
          : Effect.fail(new RangeError("Delay must be an integer between 0 and 2147483647 ms")),
    });
    for (const [id, operation] of [
      ["AND", (a: boolean, b: boolean) => a && b],
      ["NAND", (a: boolean, b: boolean) => !(a && b)],
      ["OR", (a: boolean, b: boolean) => a || b],
      ["NOR", (a: boolean, b: boolean) => !(a || b)],
      ["XOR", (a: boolean, b: boolean) => a !== b],
    ] as const) {
      yield* context.schema.register({
        id,
        name: id,
        description: `Boolean ${id} of two inputs.`,
        type: "pure",
        io: (io) => ({
          one: io.data.in("one", DataType.Bool, { defaultValue: false }),
          two: io.data.in("two", DataType.Bool, { defaultValue: false }),
          value: io.data.out("value", DataType.Bool),
        }),
        run: ({ io }) => Effect.sync(() => io.value(operation(io.one, io.two))),
      });
    }
    yield* context.schema.register({
      id: "NOT",
      name: "NOT",
      description: "Inverts a boolean input.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.Bool, { defaultValue: false }),
        output: io.data.out("output", DataType.Bool),
      }),
      run: ({ io }) => Effect.sync(() => io.output(!io.input)),
    });
    yield* context.schema.register({
      id: "Conditional",
      name: "Conditional",
      description: "Selects one of two values of the inferred type.",
      type: "pure",
      io: (io) => {
        const type = io.wildcard("T");
        return {
          condition: io.data.in("condition", DataType.Bool, {
            name: "Condition",
            defaultValue: false,
          }),
          whenTrue: io.data.in("trueValue", type, { name: "True" }),
          whenFalse: io.data.in("falseValue", type, { name: "False" }),
          output: io.data.out("output", type),
        };
      },
      run: ({ io }) => Effect.sync(() => io.output(io.condition ? io.whenTrue : io.whenFalse)),
    });
    yield* context.schema.register({
      id: "Switch",
      name: "Switch",
      type: "base",
      description:
        "Selects the first strictly equal case or Default. Keys must be between 0 and 1024. The comparison value and every case key require an input or explicit default.",
      properties: { number: { name: "Keys", type: DataType.Int, defaultValue: 1 } },
      io: (io, properties) => {
        const type = io.wildcard("T");
        return {
          exec: io.exec.in("exec"),
          input: io.data.in("switchOn", type, { name: "Data In" }),
          output: io.data.out("switchOut", type, { name: "Data Out" }),
          fallback: io.exec.out("exec", { name: "Default" }),
          cases: Array.from(
            { length: validCount(properties.number) ? properties.number : 0 },
            (_, index) => ({
              value: io.data.in(`key-${index}`, type),
              exec: io.exec.out(`key-${index}`),
            }),
          ),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          if (!validCount(properties.number))
            return yield* Effect.fail(new RangeError("Keys must be an integer between 0 and 1024"));
          io.output(io.input);
          return io.cases.find((item) => item.value === io.input)?.exec ?? io.fallback;
        }),
    });
    yield* context.schema.register({
      id: "Equal",
      name: "Equal",
      description: "Compares two values of the inferred type using strict equality.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", io.wildcard("T")),
        two: io.data.in("two", io.wildcard("T")),
        equal: io.data.out("equal", DataType.Bool),
      }),
      run: ({ io }) => Effect.sync(() => io.equal(io.one === io.two)),
    });
    yield* context.schema.register({
      id: "MakeSome",
      name: "Make Some",
      description: "Wraps a value of the inferred type in Some.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", io.wildcard("T")),
        output: io.data.out("out", DataType.Option(io.wildcard("T"))),
      }),
      run: ({ io }) => Effect.sync(() => io.output(Option.some(io.input))),
    });
    yield* context.schema.register({
      id: "UnwrapOption",
      name: "Unwrap Option",
      description: "Extracts a Some value of the inferred type; fails for None.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.Option(io.wildcard("T")), {
          defaultValue: Option.none(),
        }),
        output: io.data.out("output", io.wildcard("T")),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          if (Option.isNone(io.input)) return yield* Effect.fail(new Error("Cannot unwrap None"));
          io.output(io.input.value);
        }),
    });
    yield* context.schema.register({
      id: "UnwrapOptionOr",
      name: "Unwrap Option Or",
      description:
        "Extracts a Some value or returns the fallback of the same inferred type for None.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.Option(io.wildcard("T")), {
          defaultValue: Option.none(),
        }),
        fallback: io.data.in("or", io.wildcard("T")),
        output: io.data.out("output", io.wildcard("T")),
      }),
      run: ({ io }) => Effect.sync(() => io.output(Option.getOrElse(io.input, () => io.fallback))),
    });
    for (const [id, name, predicate] of [
      ["IsOptionSome", "Is Option Some", Option.isSome],
      ["IsOptionNone", "Is Option None", Option.isNone],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description: `${name} for an option of the inferred type.`,
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", DataType.Option(io.wildcard("T")), {
            defaultValue: Option.none(),
          }),
          output: io.data.out("output", DataType.Bool),
        }),
        run: ({ io }) => Effect.sync(() => io.output(predicate(io.input))),
      });
    }
    for (const id of ["Cache", "Copy"] as const) {
      yield* context.schema.register({
        id,
        name: id,
        description:
          id === "Copy"
            ? "Captures a value of the inferred type, shallow-copying lists without modifying the input."
            : "Captures a value of the inferred type on execution for downstream reuse; the value is not cloned.",
        io: (io) => {
          const type = io.wildcard("T");
          return {
            input: io.data.in("in", type),
            output: io.data.out("out", type),
          };
        },
        run: ({ io }) =>
          Effect.sync(() =>
            io.output(id === "Copy" && Array.isArray(io.input) ? [...io.input] : io.input),
          ),
      });
    }
  }),
});

export default LogicModule;
