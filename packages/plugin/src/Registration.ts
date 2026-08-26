import { Effect, Ref } from "effect";

import type * as DataType from "./DataType.ts";
import type * as Engine from "./Engine.ts";
import type { ExecutionContext, NodeExecutionContext } from "./ExecutionContext.ts";
import type * as Resource from "./Resource.ts";

export type SuggestionContext<Properties = Readonly<Record<string, unknown>>> = {
  readonly properties: Properties;
  readonly inputDefaults: Readonly<Record<string, unknown>>;
};

export type Suggestions<Properties = Readonly<Record<string, unknown>>> = (
  context: SuggestionContext<Properties>,
) => Effect.Effect<ReadonlyArray<string>>;

export class DataInputRef<Value = unknown> {
  readonly _tag = "DataInput" as const;
  declare readonly Value: Value;

  constructor(
    readonly id: string,
    readonly type: DataType.Any,
    readonly name?: string,
    readonly defaultValue?: Value,
    readonly suggestions?: Suggestions,
  ) {}
}

export class DataOutputRef<Value = unknown> {
  readonly _tag = "DataOutput" as const;
  declare readonly Value: Value;

  constructor(
    readonly id: string,
    readonly type: DataType.Any,
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

type InputOptions<Type extends DataType.Any, Properties> = {
  readonly name?: string;
  readonly defaultValue?: DataType.Value<Type>;
} & (DataType.Value<Type> extends string
  ? { readonly suggestions?: Suggestions<Properties> }
  : { readonly suggestions?: never });

export interface IOContext<Properties = Readonly<Record<string, unknown>>> {
  readonly data: {
    readonly in: <Type extends DataType.Any>(
      id: string,
      type: Type,
      options?: InputOptions<Type, Properties>,
    ) => DataInputRef<DataType.Value<Type>>;
    readonly out: <Type extends DataType.Any>(
      id: string,
      type: Type,
      options?: { readonly name?: string },
    ) => DataOutputRef<DataType.Value<Type>>;
  };
  readonly exec: {
    readonly in: (id: string, options?: { readonly name?: string }) => ExecutionInputRef;
    readonly out: (id: string, options?: { readonly name?: string }) => ExecutionOutputRef;
  };
}

export type ScalarPropertyDefinition<Type extends DataType.Scalar = DataType.Scalar> = {
  readonly name: string;
  readonly description?: string;
  readonly type: Type;
} & (
  | { readonly optional: true; readonly defaultValue?: DataType.Value<Type> }
  | { readonly optional?: false; readonly defaultValue: DataType.Value<Type> }
);

export type ResourcePropertyDefinition<Type extends Resource.AnyClass = Resource.AnyClass> = {
  readonly name: string;
  readonly description?: string;
  readonly resource: Type;
  readonly optional?: false;
};

export type PropertyDefinition = ScalarPropertyDefinition | ResourcePropertyDefinition;
export type PropertyDefinitions = Readonly<Record<string, PropertyDefinition>>;

export type PropertyValues<Properties extends PropertyDefinitions> = {
  readonly [Key in keyof Properties]: Properties[Key] extends ResourcePropertyDefinition<infer R>
    ? Resource.ResourceClassSelf<R>
    : Properties[Key] extends ScalarPropertyDefinition<infer Type>
      ? Properties[Key] extends { readonly optional: true }
        ? DataType.Value<Type> | undefined
        : DataType.Value<Type>
      : never;
};

type RuntimeProperties<Properties extends PropertyDefinitions> = keyof Properties extends never
  ? Readonly<Record<string, unknown>>
  : PropertyValues<Properties>;

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
  readonly engine: Engine.RuntimeClientOf<Definition>;
  readonly execution: ExecutionContext;
  readonly node: NodeExecutionContext;
};

type CommonSchema<IO, Definition extends Engine.AnyDef, Properties extends PropertyDefinitions> = {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly properties?: Properties;
  readonly io: (
    context: IOContext<RuntimeProperties<Properties>>,
    properties: RuntimeProperties<Properties>,
  ) => IO;
  readonly run: (
    context: Omit<RunContext<IO, Definition>, "properties"> & {
      readonly properties: RuntimeProperties<Properties>;
    },
  ) => Effect.Effect<void | ExecutionOutputRef, unknown>;
};

export type SchemaRegistration<
  IO,
  Definition extends Engine.AnyDef,
  Properties extends PropertyDefinitions = {},
> = CommonSchema<IO, Definition, Properties> &
  (
    | {
        readonly type: "event";
        readonly event: (
          event: Engine.EventOf<Definition>,
          context: { readonly properties: RuntimeProperties<Properties> },
        ) => Effect.Effect<boolean>;
      }
    | { readonly type?: "exec" | "pure" }
  );

export type PluginContext<Definition extends Engine.AnyDef> = {
  readonly schema: {
    readonly register: <IO, const Properties extends PropertyDefinitions = {}>(
      schema: SchemaRegistration<IO, Definition, Properties>,
    ) => Effect.Effect<void>;
  };
};

export interface RegisteredScalarProperty {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly type: DataType.Scalar;
  readonly optional: boolean;
  readonly defaultValue?: unknown;
}

export interface RegisteredResourceProperty {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly resource: string;
  readonly resourceClass: Resource.AnyClass;
  readonly optional: false;
}

export type RegisteredProperty = RegisteredScalarProperty | RegisteredResourceProperty;

export interface RegisteredSchema {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly type: "event" | "exec" | "pure";
  readonly properties: ReadonlyArray<RegisteredProperty>;
  readonly dataInputs: ReadonlyArray<DataInputRef>;
  readonly dataOutputs: ReadonlyArray<DataOutputRef>;
  readonly executionInputs: ReadonlyArray<ExecutionInputRef>;
  readonly executionOutputs: ReadonlyArray<ExecutionOutputRef>;
  readonly generateIO: (properties: Readonly<Record<string, unknown>>) => RegisteredNodeIO;
  readonly matches: (
    event: { readonly _tag: string },
    properties: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<boolean>;
  readonly run: (context: {
    readonly input: (ref: DataInputRef) => unknown;
    readonly output: (ref: DataOutputRef, value: unknown) => void;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly event: { readonly _tag: string } | undefined;
    readonly engine: unknown;
    readonly execution: ExecutionContext;
    readonly node: NodeExecutionContext;
  }) => Effect.Effect<void | ExecutionOutputRef, unknown>;
}

export interface RegisteredNodeIO {
  readonly dataInputs: ReadonlyArray<DataInputRef>;
  readonly dataOutputs: ReadonlyArray<DataOutputRef>;
  readonly executionInputs: ReadonlyArray<ExecutionInputRef>;
  readonly executionOutputs: ReadonlyArray<ExecutionOutputRef>;
}

const ioContext: IOContext<Readonly<Record<string, unknown>>> = {
  data: {
    in: (id, type, options) =>
      new DataInputRef(id, type, options?.name, options?.defaultValue, options?.suggestions),
    out: (id, type, options) => new DataOutputRef(id, type, options?.name),
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

function materialize<Value>(
  value: Value,
  context: Parameters<RegisteredSchema["run"]>[0],
): Materialized<Value>;
function materialize(value: unknown, context: Parameters<RegisteredSchema["run"]>[0]): unknown {
  if (value instanceof DataInputRef) return context.input(value);
  if (value instanceof DataOutputRef) return (output: unknown) => context.output(value, output);
  if (value instanceof ExecutionInputRef || value instanceof ExecutionOutputRef) return value;
  if (Array.isArray(value)) return value.map((item) => materialize(item, context));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materialize(item, context)]),
    );
  return value;
}

const makeRegistered = <
  IO,
  Definition extends Engine.AnyDef,
  Properties extends PropertyDefinitions,
>(
  schema: SchemaRegistration<IO, Definition, Properties>,
): RegisteredSchema => {
  const type = schema.type ?? "exec";
  const withDefaults = (properties: Readonly<Record<string, unknown>>) => {
    const resolved: Record<string, unknown> = { ...properties };
    for (const [id, definition] of Object.entries(schema.properties ?? {})) {
      if (
        "type" in definition &&
        !Object.hasOwn(resolved, id) &&
        definition.defaultValue !== undefined
      ) {
        resolved[id] = definition.defaultValue;
      }
    }
    return resolved as RuntimeProperties<Properties>;
  };
  const generate = (properties: Readonly<Record<string, unknown>>) => {
    const refs = collectRefs(
      schema.io(ioContext as IOContext<RuntimeProperties<Properties>>, withDefaults(properties)),
    );
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
      dataInputs: refs.filter((ref): ref is DataInputRef => ref instanceof DataInputRef),
      dataOutputs: refs.filter((ref): ref is DataOutputRef => ref instanceof DataOutputRef),
      executionInputs,
      executionOutputs,
    };
  };
  const initial = generate(withDefaults({}));

  return {
    id: schema.id,
    name: schema.name ?? schema.id,
    ...(schema.description === undefined ? {} : { description: schema.description }),
    type,
    properties: Object.entries(schema.properties ?? {}).map(([id, property]) =>
      "resource" in property
        ? {
            id,
            name: property.name,
            ...(property.description === undefined ? {} : { description: property.description }),
            resource: property.resource.key,
            resourceClass: property.resource,
            optional: false as const,
          }
        : {
            id,
            name: property.name,
            ...(property.description === undefined ? {} : { description: property.description }),
            type: property.type,
            optional: property.optional === true,
            ...(property.defaultValue === undefined ? {} : { defaultValue: property.defaultValue }),
          },
    ),
    ...initial,
    generateIO: generate,
    matches:
      schema.type === "event"
        ? (event, properties) =>
            schema.event(event as Engine.EventOf<Definition>, {
              properties: withDefaults(properties),
            })
        : () => Effect.succeed(false),
    run: (context) => {
      const io = schema.io(
        ioContext as IOContext<RuntimeProperties<Properties>>,
        withDefaults(context.properties),
      );
      return schema.run({
        io: materialize(io, context),
        properties: withDefaults(context.properties),
        event: context.event as Engine.EventOf<Definition> | undefined,
        engine: context.engine as Engine.RuntimeClientOf<Definition>,
        execution: context.execution,
        node: context.node,
      });
    },
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
