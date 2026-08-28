import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration.js";
import utc from "dayjs/plugin/utc.js";
import { Effect, Inspectable } from "effect";

import { UtilitiesEngine } from "./Definition.ts";

dayjs.extend(duration);
dayjs.extend(utc);

export type FormatBlock =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "placeholder"; readonly name: string };

const placeholderName = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parses `{name}` placeholders. `{{` and `}}` escape braces; malformed or
 * invalid placeholders remain literal text.
 */
export const parseFormatString = (format: string): ReadonlyArray<FormatBlock> => {
  const blocks: Array<FormatBlock> = [];
  let text = "";
  const flushText = () => {
    if (text === "") return;
    blocks.push({ type: "text", value: text });
    text = "";
  };

  for (let index = 0; index < format.length; ) {
    const character = format[index];
    if (character === "{" && format[index + 1] === "{") {
      text += "{";
      index += 2;
      continue;
    }
    if (character === "}" && format[index + 1] === "}") {
      text += "}";
      index += 2;
      continue;
    }
    if (character !== "{") {
      text += character;
      index += 1;
      continue;
    }

    const close = format.indexOf("}", index + 1);
    if (close === -1) {
      text += format.slice(index);
      break;
    }
    const name = format.slice(index + 1, close);
    if (!placeholderName.test(name)) {
      text += format.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    flushText();
    blocks.push({ type: "placeholder", name });
    index = close + 1;
  }
  flushText();
  return blocks;
};

export const formatValue = (value: unknown): string => Inspectable.toStringUnknown(value, 0);

const UtilitiesPlugin = Plugin.make({
  id: "util",
  name: "Utilities",
  engine: UtilitiesEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "Print",
      name: "Print",
      description:
        "Writes a string to the configured Effect logger at log (info), warn, or error severity.",
      properties: {
        type: { name: "Type", type: DataType.String, defaultValue: "log" },
      },
      io: (io) => ({
        value: io.data.in("in", DataType.String, { name: "Input", defaultValue: "" }),
      }),
      run: ({ io, properties }) => {
        switch (properties.type) {
          case "log":
            return Effect.logInfo("Utilities Print", { value: io.value });
          case "warn":
            return Effect.logWarning("Utilities Print", { value: io.value });
          case "error":
            return Effect.logError("Utilities Print", { value: io.value });
          default:
            return Effect.fail(new TypeError("Type must be log, warn, or error"));
        }
      },
    });
    yield* context.schema.register({
      id: "ConcatStrings",
      name: "Concat Strings",
      description: "Concatenates two strings without a separator.",
      type: "pure",
      io: (io) => ({
        first: io.data.in("str1", DataType.String, { name: "First", defaultValue: "" }),
        second: io.data.in("str2", DataType.String, { name: "Second", defaultValue: "" }),
        result: io.data.out("result", DataType.String, { name: "Result" }),
      }),
      run: ({ io }) => Effect.sync(() => io.result(io.first + io.second)),
    });
    yield* context.schema.register({
      id: "IntToString",
      name: "Int To String",
      description: "Converts an integer to its decimal string representation.",
      type: "pure",
      io: (io) => ({
        value: io.data.in("int", DataType.Int, { name: "Integer", defaultValue: 0 }),
        result: io.data.out("str", DataType.String, { name: "String" }),
      }),
      run: ({ io }) =>
        Number.isInteger(io.value)
          ? Effect.sync(() => io.result(String(io.value)))
          : Effect.fail(new TypeError("Int To String requires an integer")),
    });
    yield* context.schema.register({
      id: "Branch",
      name: "Branch",
      description: "Routes execution to True or False based on a boolean condition.",
      io: (io) => ({
        condition: io.data.in("condition", DataType.Bool, {
          name: "Condition",
          defaultValue: false,
        }),
        whenTrue: io.exec.out("trueOut", { name: "True" }),
        whenFalse: io.exec.out("falseOut", { name: "False" }),
      }),
      run: ({ io }) => Effect.succeed(io.condition ? io.whenTrue : io.whenFalse),
    });
    yield* context.schema.register({
      id: "FormatString",
      name: "Format String",
      description:
        "Formats `{name}` placeholders. Escape braces as `{{` or `}}`; invalid placeholders are literal.",
      type: "pure",
      properties: {
        format: {
          name: "Format",
          description: "Template containing `{name}` placeholders.",
          type: DataType.String,
          defaultValue: "",
        },
      },
      io: (io, properties) => {
        const blocks = parseFormatString(properties.format);
        const names = blocks.flatMap((block) => (block.type === "placeholder" ? [block.name] : []));
        const inputs = new Map(
          [...new Set(names)].map((name) => [
            name,
            io.data.in(name, DataType.String, { name, defaultValue: "" }),
          ]),
        );
        return {
          blocks,
          inputs: [...inputs.entries()].map(([name, input]) => ({ name, input })),
          result: io.data.out("result", DataType.String, { name: "Result" }),
        };
      },
      run: ({ io }) =>
        Effect.sync(() => {
          const values = new Map(io.inputs.map(({ name, input }) => [name, input]));
          io.result(
            io.blocks
              .map((block) =>
                block.type === "text" ? block.value : formatValue(values.get(block.name) ?? ""),
              )
              .join(""),
          );
        }),
    });
    yield* context.schema.register({
      id: "FormatTime",
      name: "Format Time",
      description:
        "Formats epoch milliseconds in UTC with English Day.js tokens, or formats a duration in milliseconds. Invalid timestamps and non-safe-integer inputs fail.",
      type: "pure",
      properties: {
        string: { name: "Format", type: DataType.String, defaultValue: "" },
        duration: { name: "Duration", type: DataType.Bool, defaultValue: false },
      },
      io: (io) => ({
        input: io.data.in("timeIn", DataType.Int, { name: "Time (ms)", defaultValue: 0 }),
        output: io.data.out("timeOut", DataType.String),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          if (!Number.isSafeInteger(io.input))
            return yield* Effect.fail(
              new RangeError("Time must be a safe integer in milliseconds"),
            );
          if (properties.duration) {
            yield* Effect.try({
              try: () => io.output(dayjs.duration(io.input).format(properties.string)),
              catch: (error) => error,
            });
          } else {
            const time = yield* Effect.try({
              try: () => dayjs.utc(io.input).locale("en"),
              catch: (error) => error,
            });
            const valid = yield* Effect.try({ try: () => time.isValid(), catch: (error) => error });
            if (!valid)
              return yield* Effect.fail(new RangeError("Time is outside the supported date range"));
            yield* Effect.try({
              try: () => io.output(time.format(properties.string)),
              catch: (error) => error,
            });
          }
        }),
    });
    yield* context.schema.register({
      id: "Tick",
      name: "Tick",
      description: "Runs periodically at a configurable whole-second interval.",
      type: "event",
      properties: {
        intervalSeconds: {
          name: "Interval (seconds)",
          description: "Runs every positive whole N seconds.",
          type: DataType.Int,
          defaultValue: 1,
        },
      },
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "TickEvent" &&
            Number.isSafeInteger(properties.intervalSeconds) &&
            properties.intervalSeconds > 0 &&
            event.tick % properties.intervalSeconds === 0,
        ),
      io: (io) => ({
        tick: io.data.out("tick", DataType.Int, { name: "Tick" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event?._tag === "TickEvent") io.tick(event.tick);
        }),
    });
  }),
});

export default UtilitiesPlugin;
