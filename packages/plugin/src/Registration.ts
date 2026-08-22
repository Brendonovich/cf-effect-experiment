import { Effect, Ref } from "effect";

import type * as Engine from "./Engine.ts";

export class DataInputRef<Value = unknown> {
  readonly _tag = "DataInput" as const;
  declare readonly Value: Value;

  constructor(
    readonly id: string,
    readonly name?: string,
    readonly defaultValue?: Value,
  ) {}
}

export class DataOutputRef<Value = unknown> {
  readonly _tag = "DataOutput" as const;
  declare readonly Value: Value;

  constructor(
    readonly id: string,
    readonly name?: string,
  ) {}
}

export class ExecutionInputRef {
  readonly _tag = "ExecutionInput" as const;

  constructor(
    readonly id: string,
    readonly name?: string,
  ) {}
}

export class ExecutionOutputRef {
  readonly _tag = "ExecutionOutput" as const;

  constructor(
    readonly id: string,
    readonly name?: string,
  ) {}
}

export interface IOContext {
  readonly data: {
    readonly in: <Value = unknown>(
      id: string,
      options?: { readonly name?: string; readonly defaultValue?: Value },
    ) => DataInputRef<Value>;
    readonly out: <Value = unknown>(
      id: string,
      options?: { readonly name?: string },
    ) => DataOutputRef<Value>;
  };
  readonly exec: {
    readonly in: (id: string, options?: { readonly name?: string }) => ExecutionInputRef;
    readonly out: (id: string, options?: { readonly name?: string }) => ExecutionOutputRef;
  };
}

export type Materialized<IO> =
  IO extends DataInputRef<infer Value>
    ? Value
    : IO extends DataOutputRef<infer Value>
      ? (value: Value) => void
      : IO extends ReadonlyArray<infer Value>
        ? ReadonlyArray<Materialized<Value>>
        : IO extends object
          ? { readonly [Key in keyof IO]: Materialized<IO[Key]> }
          : IO;

export type RunContext<IO, Definition extends Engine.AnyDef> = {
  readonly io: Materialized<IO>;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly event: Engine.EventOf<Definition> | undefined;
};

type CommonSchema<IO, Definition extends Engine.AnyDef> = {
  readonly id: string;
  readonly name?: string;
  readonly io: (context: IOContext) => IO;
  readonly run: (context: RunContext<IO, Definition>) => Effect.Effect<void | ExecutionOutputRef>;
};

export type SchemaRegistration<IO, Definition extends Engine.AnyDef> = CommonSchema<
  IO,
  Definition
> &
  (
    | {
        readonly type: "event";
        readonly event: (
          event: Engine.EventOf<Definition>,
          context: { readonly properties: Readonly<Record<string, unknown>> },
        ) => Effect.Effect<boolean>;
      }
    | { readonly type?: "exec" | "pure" }
  );

export type PluginContext<Definition extends Engine.AnyDef> = {
  readonly schema: {
    readonly register: <IO>(schema: SchemaRegistration<IO, Definition>) => Effect.Effect<void>;
  };
};

export interface RegisteredSchema {
  readonly id: string;
  readonly name: string;
  readonly type: "event" | "exec" | "pure";
  readonly io: unknown;
  readonly dataInputs: ReadonlyArray<DataInputRef>;
  readonly dataOutputs: ReadonlyArray<DataOutputRef>;
  readonly executionInputs: ReadonlyArray<ExecutionInputRef>;
  readonly executionOutputs: ReadonlyArray<ExecutionOutputRef>;
  readonly matches: (
    event: { readonly _tag: string },
    properties: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<boolean>;
  readonly run: (context: {
    readonly input: (ref: DataInputRef) => unknown;
    readonly output: (ref: DataOutputRef, value: unknown) => void;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly event: { readonly _tag: string } | undefined;
  }) => Effect.Effect<void | ExecutionOutputRef>;
}

const ioContext: IOContext = {
  data: {
    in: (id, options) => new DataInputRef(id, options?.name, options?.defaultValue),
    out: (id, options) => new DataOutputRef(id, options?.name),
  },
  exec: {
    in: (id, options) => new ExecutionInputRef(id, options?.name),
    out: (id, options) => new ExecutionOutputRef(id, options?.name),
  },
};

const collectRefs = (value: unknown): ReadonlyArray<IORef> => {
  if (
    value instanceof DataInputRef ||
    value instanceof DataOutputRef ||
    value instanceof ExecutionInputRef ||
    value instanceof ExecutionOutputRef
  )
    return [value];
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(collectRefs);
  return [];
};

type IORef = DataInputRef | DataOutputRef | ExecutionInputRef | ExecutionOutputRef;

const materialize = (value: unknown, context: Parameters<RegisteredSchema["run"]>[0]): unknown => {
  if (value instanceof DataInputRef) return context.input(value);
  if (value instanceof DataOutputRef) return (output: unknown) => context.output(value, output);
  if (value instanceof ExecutionInputRef || value instanceof ExecutionOutputRef) return value;
  if (Array.isArray(value)) return value.map((item) => materialize(item, context));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materialize(item, context)]),
    );
  return value;
};

const makeRegistered = <IO, Definition extends Engine.AnyDef>(
  schema: SchemaRegistration<IO, Definition>,
): RegisteredSchema => {
  const io = schema.io(ioContext);
  const refs = collectRefs(io);
  const type = schema.type ?? "exec";
  const executionInputs = refs.filter(
    (ref): ref is ExecutionInputRef => ref instanceof ExecutionInputRef,
  );
  const executionOutputs = refs.filter(
    (ref): ref is ExecutionOutputRef => ref instanceof ExecutionOutputRef,
  );
  if (type === "exec" && !executionInputs.some((input) => input.id === "exec"))
    executionInputs.unshift(new ExecutionInputRef("exec"));
  if (type !== "pure" && !executionOutputs.some((output) => output.id === "exec"))
    executionOutputs.unshift(new ExecutionOutputRef("exec"));

  return {
    id: schema.id,
    name: schema.name ?? schema.id,
    type,
    io,
    dataInputs: refs.filter((ref): ref is DataInputRef => ref instanceof DataInputRef),
    dataOutputs: refs.filter((ref): ref is DataOutputRef => ref instanceof DataOutputRef),
    executionInputs,
    executionOutputs,
    matches:
      schema.type === "event"
        ? (event, properties) => schema.event(event as Engine.EventOf<Definition>, { properties })
        : () => Effect.succeed(false),
    run: (context) =>
      schema.run({
        io: materialize(io, context) as Materialized<IO>,
        properties: context.properties,
        event: context.event as Engine.EventOf<Definition> | undefined,
      }),
  };
};

export const collect = <Definition extends Engine.AnyDef>(
  effect: (context: PluginContext<Definition>) => Effect.Effect<void>,
): Effect.Effect<ReadonlyArray<RegisteredSchema>> =>
  Effect.gen(function* () {
    const schemas = yield* Ref.make<ReadonlyArray<RegisteredSchema>>([]);
    const context: PluginContext<Definition> = {
      schema: {
        register: (schema) =>
          Ref.update(schemas, (registered) => [
            ...registered.filter((item) => item.id !== schema.id),
            makeRegistered(schema),
          ]),
      },
    };
    yield* effect(context);
    return yield* Ref.get(schemas);
  });
