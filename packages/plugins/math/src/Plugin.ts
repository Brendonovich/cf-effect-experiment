import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Clock, Effect, Random } from "effect";

const checked = Effect.fnUntraced(function* (value: number, type: DataType.Int | DataType.Float) {
  if (!Number.isFinite(value) || (type._tag === "Int" && !Number.isSafeInteger(value)))
    return yield* Effect.fail(
      new RangeError(type._tag === "Int" ? "Expected a safe integer" : "Expected a finite number"),
    );
  return value;
});

const MathPlugin = Plugin.make({
  id: "math",
  name: "Math",
  effect: Effect.fnUntraced(function* (context) {
    for (const [suffix, type] of [
      ["Ints", DataType.Int],
      ["Floats", DataType.Float],
    ] as const) {
      for (const [operation, calculate] of [
        ["Add", (a: number, b: number) => a + b],
        ["Subtract", (a: number, b: number) => a - b],
        ["Multiply", (a: number, b: number) => a * b],
        ["Divide", (a: number, b: number) => (type._tag === "Int" ? Math.floor(a / b) : a / b)],
        ["Min", Math.min],
        ["Max", Math.max],
      ] as const) {
        yield* context.schema.register({
          id: `${operation}${suffix}`,
          name: `${operation} ${suffix}`,
          description: `${operation} two ${suffix.toLowerCase()}. Integer division rounds down. Nonfinite results and unsafe integers fail.`,
          type: "pure",
          io: (io) => ({
            one: io.data.in("one", type, { defaultValue: 0 }),
            two: io.data.in("two", type, { defaultValue: operation === "Divide" ? 1 : 0 }),
            output: io.data.out("output", type),
          }),
          run: ({ io }) =>
            Effect.gen(function* () {
              const one = yield* checked(io.one, type);
              const two = yield* checked(io.two, type);
              if (operation === "Divide" && two === 0)
                return yield* Effect.fail(new RangeError("Cannot divide by zero"));
              const value = yield* checked(calculate(one, two), type);
              yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
            }),
        });
      }
      yield* context.schema.register({
        id: `Remainder${type._tag}`,
        name: `Remainder ${type._tag}`,
        description:
          "Computes the signed remainder. A zero divisor, nonfinite numbers, and unsafe integers fail.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", type, { defaultValue: 0 }),
          divisor: io.data.in("divisor", type, { defaultValue: 1 }),
          output: io.data.out("remainder", type),
        }),
        run: ({ io }) =>
          Effect.gen(function* () {
            if (io.divisor === 0)
              return yield* Effect.fail(new RangeError("Cannot divide by zero"));
            const input = yield* checked(io.input, type);
            const divisor = yield* checked(io.divisor, type);
            const value = yield* checked(input % divisor, type);
            yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
          }),
      });
      yield* context.schema.register({
        id: `Compare${type._tag}`,
        name: `Compare ${type._tag}`,
        description: "Reports strict equality, greater-than, and less-than for two valid numbers.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("number", type, { defaultValue: 0 }),
          compare: io.data.in("compare", type, { defaultValue: 0 }),
          equal: io.data.out("outputE", DataType.Bool, { name: "Equal" }),
          greater: io.data.out("outputG", DataType.Bool, { name: "Greater" }),
          less: io.data.out("outputL", DataType.Bool, { name: "Less" }),
        }),
        run: ({ io }) =>
          Effect.gen(function* () {
            const input = yield* checked(io.input, type);
            const compare = yield* checked(io.compare, type);
            yield* Effect.try({
              try: () => {
                io.equal(input === compare);
                io.greater(input > compare);
                io.less(input < compare);
              },
              catch: (error) => error,
            });
          }),
      });
    }
    for (const [id, name, inputType, calculate] of [
      ["DivideIntsExact", "Divide Ints Exact", DataType.Int, (a: number, b: number) => a / b],
      ["ExponentFloats", "Exponent Floats", DataType.Float, (a: number, b: number) => a ** b],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description:
          "Computes a finite floating-point result. Invalid domains, zero division, and overflow fail.",
        type: "pure",
        io: (io) => ({
          one: io.data.in("one", inputType, { defaultValue: 0 }),
          two: io.data.in("two", inputType, { defaultValue: 1 }),
          output: io.data.out("output", DataType.Float),
        }),
        run: ({ io }) =>
          Effect.gen(function* () {
            const one = yield* checked(io.one, inputType);
            const two = yield* checked(io.two, inputType);
            if (id === "DivideIntsExact" && two === 0)
              return yield* Effect.fail(new RangeError("Cannot divide by zero"));
            const value = yield* checked(calculate(one, two), DataType.Float);
            yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
          }),
      });
    }
    for (const [id, name, inputType, outputType, calculate] of [
      ["Sin", "Sin", DataType.Float, DataType.Float, Math.sin],
      ["Cos", "Cos", DataType.Float, DataType.Float, Math.cos],
      ["Tan", "Tan", DataType.Float, DataType.Float, Math.tan],
      ["FloatToInt", "Float To Int", DataType.Float, DataType.Int, Math.round],
      ["IntToFloat", "Int To Float", DataType.Int, DataType.Float, (value: number) => value],
      ["FloorFloat", "Floor Float", DataType.Float, DataType.Int, Math.floor],
      ["MakeInt", "Make Int", DataType.Int, DataType.Int, (value: number) => value],
      ["MakeFloat", "Make Float", DataType.Float, DataType.Float, (value: number) => value],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description: `${name} of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.`,
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", inputType, { defaultValue: 0 }),
          output: io.data.out("output", outputType),
        }),
        run: ({ io }) =>
          Effect.gen(function* () {
            const input = yield* checked(io.input, inputType);
            const value = yield* checked(calculate(input), outputType);
            yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
          }),
      });
    }
    yield* context.schema.register({
      id: "RoundFloat",
      name: "Round Float",
      description: "Rounds a finite float to -308 through 308 decimal places. Overflow fails.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.Float, { defaultValue: 0 }),
        decimal: io.data.in("decimal", DataType.Int, { name: "Decimal Places", defaultValue: 0 }),
        output: io.data.out("output", DataType.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          yield* checked(io.input, DataType.Float);
          if (!Number.isSafeInteger(io.decimal) || Math.abs(io.decimal) > 308)
            return yield* Effect.fail(
              new RangeError("Decimal places must be an integer between -308 and 308"),
            );
          const scale = 10 ** io.decimal;
          const value = yield* checked(Math.round(io.input * scale) / scale, DataType.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    for (const [id, name, type] of [
      ["RandomFloat", "Random Float", DataType.Float],
      ["RandomInteger", "Random Integer", DataType.Int],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description:
          type._tag === "Int"
            ? "Samples 0 or 1 with equal probability using Effect Random."
            : "Samples a float in [0, 1) using Effect Random.",
        io: (io) => ({ output: io.data.out("output", type) }),
        run: ({ io }) =>
          Random.next.pipe(
            Effect.map((value) => io.output(type._tag === "Int" ? Math.floor(value * 2) : value)),
          ),
      });
      yield* context.schema.register({
        id: `${id}InRange`,
        name: `${name} In Range`,
        description:
          type._tag === "Int"
            ? "Samples an integer from the inclusive range [min, max]. Bounds and range width must be safe integers."
            : "Samples a float in [min, max), or min when equal. Bounds and range width must be finite.",
        io: (io) => ({
          min: io.data.in("min", type, { defaultValue: 0 }),
          max: io.data.in("max", type, { defaultValue: 1 }),
          output: io.data.out("output", type),
        }),
        run: ({ io }) =>
          Effect.gen(function* () {
            const min = yield* checked(io.min, type);
            const max = yield* checked(io.max, type);
            if (min > max)
              return yield* Effect.fail(new RangeError("Minimum must not exceed maximum"));
            const width = yield* checked(max - min + (type._tag === "Int" ? 1 : 0), type);
            const random = yield* Random.next;
            const value =
              type._tag === "Int" ? io.min + Math.floor(random * width) : io.min + random * width;
            // Adjacent floating-point bounds can round a sample up to the excluded maximum.
            io.output(
              type._tag === "Float" && io.min < io.max && value >= io.max
                ? io.min
                : Math.min(io.max, value),
            );
          }),
      });
    }
    for (const [id, name] of [
      ["DateNow", "Date Now (ms)"],
      ["CurrentTimestamp", "Current Timestamp (ms)"],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description:
          "Samples epoch milliseconds from the Effect clock on execution, rather than as a pure value.",
        io: (io) => ({ output: io.data.out("out", DataType.Int, { name: "Timestamp (ms)" }) }),
        run: ({ io }) => Clock.currentTimeMillis.pipe(Effect.map((value) => io.output(value))),
      });
    }
  }),
});

export default MathPlugin;
