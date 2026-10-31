import { Effect, Ref } from "effect";

import type * as Engine from "./Engine.ts";
import type { ExecutionContext, NodeExecutionContext } from "./ExecutionContext.ts";
import type * as ModuleId from "./ModuleId.ts";
import type * as Resource from "./Resource.ts";

import * as Conversion from "./Conversion.ts";
import * as t from "./DataType.ts";
import * as TypeScope from "./internal/typeScope.ts";

/**
 * Port refs are recognized by brand rather than `instanceof`, so refs created by a module that
 * bundles (or was evaluated against) a different copy of this file are still understood.
 */
export const PortTypeId: unique symbol = Symbol.for("~macrograph/Module/Registration/Port");
export const ScopeTypeId: unique symbol = Symbol.for("~macrograph/Module/Registration/Scope");
export const ScopeExecutionTypeId: unique symbol = Symbol.for(
  "~macrograph/Module/Registration/ScopeExecution",
);

export type SuggestionContext<
  Properties = Readonly<Record<string, unknown>>,
  EngineClient = unknown,
> = {
  readonly properties: Properties;
  readonly inputDefaults: Readonly<Record<string, unknown>>;
  readonly engine: EngineClient;
};

export type Suggestions<Properties = Readonly<Record<string, unknown>>, EngineClient = unknown> = (
  context: SuggestionContext<Properties, EngineClient>,
) => Effect.Effect<ReadonlyArray<string>, unknown>;

export class DataInputRef<Value = unknown> {
  readonly [PortTypeId] = PortTypeId;
  readonly _tag = "DataInput" as const;
  declare readonly Value: Value;

  constructor(
    readonly id: string,
    readonly type: t.Type,
    readonly name?: string,
    readonly defaultValue?: Value,
    readonly suggestions?: Suggestions,
  ) {}
}

export class DataOutputRef<Value = unknown> {
  readonly [PortTypeId] = PortTypeId;
  readonly _tag = "DataOutput" as const;
  declare readonly Value: Value;

  constructor(
    readonly id: string,
    readonly type: t.Type,
    readonly name?: string,
  ) {}
}

export class ExecutionInputRef {
  readonly [PortTypeId] = PortTypeId;
  readonly _tag = "ExecutionInput" as const;

  constructor(
    readonly id: string,
    readonly name?: string,
    readonly scope?: ReadonlyArray<ScopeField> | null,
  ) {}
}

export class ExecutionOutputRef {
  readonly [PortTypeId] = PortTypeId;
  readonly _tag = "ExecutionOutput" as const;

  constructor(
    readonly id: string,
    readonly name?: string,
    readonly scope?: ReadonlyArray<ScopeField>,
  ) {}
}

export interface ScopeField {
  readonly id: string;
  readonly name?: string | undefined;
  readonly type: t.Type;
}

export type ScopeFields = Readonly<Record<string, t.Type>>;
export type ScopeValue<Fields extends ScopeFields> = {
  readonly [Key in keyof Fields]: t.Value<Fields[Key]>;
};

/** A selected execution branch and its payload are returned atomically. */
export class ScopeExecution extends ExecutionOutputRef {
  readonly [ScopeExecutionTypeId] = ScopeExecutionTypeId;
  constructor(
    output: ExecutionOutputRef,
    readonly payload: Readonly<Record<string, unknown>>,
  ) {
    super(output.id, output.name, output.scope);
  }
}

export class ScopeOutputRef<Value = Readonly<Record<string, unknown>>> extends ExecutionOutputRef {
  readonly [ScopeTypeId] = ScopeTypeId;
  declare readonly Value: Value;
  constructor(id: string, fields: ReadonlyArray<ScopeField>, name?: string) {
    super(id, name, fields);
  }
}

export class ScopeInputRef<Value = Readonly<Record<string, unknown>>> extends ExecutionInputRef {
  readonly [ScopeTypeId] = ScopeTypeId;
  declare readonly Value: Value;
  constructor(id: string, fields: ReadonlyArray<ScopeField> | null, name?: string) {
    super(id, name, fields);
  }
}

const hasBrand = (value: unknown, brand: symbol): boolean =>
  typeof value === "object" && value !== null && Reflect.get(value, brand) === brand;

type PortRef = DataInputRef | DataOutputRef | ExecutionInputRef | ExecutionOutputRef;

export const isPort = (value: unknown): value is PortRef => hasBrand(value, PortTypeId);
export const isDataInput = (value: unknown): value is DataInputRef =>
  isPort(value) && value._tag === "DataInput";
export const isDataOutput = (value: unknown): value is DataOutputRef =>
  isPort(value) && value._tag === "DataOutput";
export const isExecutionInput = (value: unknown): value is ExecutionInputRef =>
  isPort(value) && value._tag === "ExecutionInput";
export const isExecutionOutput = (value: unknown): value is ExecutionOutputRef =>
  isPort(value) && value._tag === "ExecutionOutput";
export const isScopeInput = (value: unknown): value is ScopeInputRef =>
  isExecutionInput(value) && hasBrand(value, ScopeTypeId);
export const isScopeOutput = (value: unknown): value is ScopeOutputRef =>
  isExecutionOutput(value) && hasBrand(value, ScopeTypeId);
export const isScopeExecution = (value: unknown): value is ScopeExecution =>
  isExecutionOutput(value) && hasBrand(value, ScopeExecutionTypeId);

const scopeFields = (fields: ScopeFields): ReadonlyArray<ScopeField> =>
  Object.entries(fields).map(([id, type]) => ({ id, name: id, type }));

/** null denotes an inferred scope input (used by scope projections). */
export const scopesCompatible = (
  output: ReadonlyArray<ScopeField> | null | undefined,
  input: ReadonlyArray<ScopeField> | null | undefined,
): boolean => {
  if (output === undefined || input === undefined) return output === input;
  if (output === null) return false;
  if (new Set(output.map((field) => field.id)).size !== output.length) return false;
  if (input !== null && new Set(input.map((field) => field.id)).size !== input.length) return false;
  return (
    input === null ||
    (output.length === input.length &&
      input.every((field) =>
        output.some(
          (candidate) => candidate.id === field.id && t.compatible(candidate.type, field.type),
        ),
      ))
  );
};

type InputOptions<Type extends t.Type, Properties, EngineClient> = {
  readonly name?: string;
  readonly defaultValue?: t.Value<Type>;
} & (t.Value<Type> extends string
  ? { readonly suggestions?: Suggestions<Properties, EngineClient> }
  : { readonly suggestions?: never });

export interface IOContext<Properties = Readonly<Record<string, unknown>>, EngineClient = unknown> {
  readonly wildcard: (id: string) => t.Wildcard;
  readonly data: {
    readonly in: <Type extends t.Type>(
      id: string,
      type: Type,
      options?: InputOptions<Type, Properties, EngineClient>,
    ) => DataInputRef<t.Value<Type>>;
    readonly out: <Type extends t.Type>(
      id: string,
      type: Type,
      options?: { readonly name?: string },
    ) => DataOutputRef<t.Value<Type>>;
  };
  readonly exec: {
    readonly in: (id: string, options?: { readonly name?: string }) => ExecutionInputRef;
    readonly out: (id: string, options?: { readonly name?: string }) => ExecutionOutputRef;
  };
  readonly scope: {
    readonly in: <Fields extends ScopeFields>(
      id: string,
      fields: Fields,
      options?: { readonly name?: string },
    ) => ScopeInputRef<ScopeValue<Fields>>;
    readonly out: <Fields extends ScopeFields>(
      id: string,
      fields: Fields,
      options?: { readonly name?: string },
    ) => ScopeOutputRef<ScopeValue<Fields>>;
  };
}

export type ScalarPropertyDefinition<Type extends t.Scalar = t.Scalar> = {
  readonly name: string;
  readonly description?: string;
  readonly type: Type;
} & (
  | { readonly optional: true; readonly defaultValue?: t.Value<Type> }
  | { readonly optional?: false; readonly defaultValue: t.Value<Type> }
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
        ? t.Value<Type> | undefined
        : t.Value<Type>
      : never;
};

type RuntimeProperties<Properties extends PropertyDefinitions> = keyof Properties extends never
  ? Readonly<Record<string, unknown>>
  : PropertyValues<Properties>;

export type Materialized<IO> = IO extends t.Type | t.Definition | t.Variant | t.Field
  ? IO
  : IO extends ScopeOutputRef<infer Value>
    ? (value: Value) => ScopeExecution
    : IO extends ScopeInputRef<infer Value>
      ? Value
      : IO extends ExecutionInputRef | ExecutionOutputRef
        ? IO
        : IO extends DataInputRef<infer Value>
          ? Value
          : IO extends DataOutputRef<infer Value>
            ? (value: Value) => void
            : IO extends ReadonlyArray<infer Value>
              ? ReadonlyArray<Materialized<Value>>
              : IO extends object
                ? { readonly [Key in keyof IO]: Materialized<IO[Key]> }
                : IO;

export interface RuntimeTypes {
  readonly resolve: (type: t.Type) => t.Type;
  readonly definitions: t.Definitions;
}

export type RunContext<IO, Definition extends Engine.AnyDef> = {
  readonly io: Materialized<IO>;
  readonly types: RuntimeTypes;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly event: Engine.EventOf<Definition> | undefined;
  readonly engine: Engine.RuntimeClientOf<Definition>;
  readonly execution: ExecutionContext;
  readonly node: NodeExecutionContext;
};

export type Replay = "safe" | "unsafe";

type CommonSchema<IO, Definition extends Engine.AnyDef, Properties extends PropertyDefinitions> = {
  readonly id: string;
  readonly internal?: boolean;
  readonly name?: string;
  readonly description?: string;
  /**
   * Whether an unfinished invocation may be repeated when its outcome is unknown,
   * such as after a worker crash. Defaults to "unsafe", independently of node type.
   * This does not make ordinary failures retryable; those must explicitly fail with Retry.
   */
  readonly replay?: Replay;
  readonly properties?: Properties;
  readonly io: (
    context: IOContext<RuntimeProperties<Properties>, Engine.RuntimeClientOf<Definition>>,
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
    | { readonly type?: "base" | "exec" | "pure" }
  );

/** Whether an IO value declares any data, execution or scope input. */
type HasInputs<IO> = IO extends DataInputRef | ExecutionInputRef
  ? true
  : IO extends DataOutputRef | ExecutionOutputRef | t.Type
    ? false
    : IO extends ReadonlyArray<infer Item>
      ? HasInputs<Item>
      : IO extends object
        ? true extends { [Key in keyof IO]: HasInputs<IO[Key]> }[keyof IO]
          ? true
          : false
        : false;

/** Rejects event registrations whose IO declares inputs; see `EventInputsError`. */
export type EventInputsGuard<IO> =
  true extends HasInputs<IO>
    ? { readonly type?: "base" | "exec" | "pure"; readonly eventNodesCannotHaveInputs?: never }
    : unknown;

export type ModuleContext<Definition extends Engine.AnyDef> = {
  readonly schema: {
    readonly register: <IO, const Properties extends PropertyDefinitions = {}>(
      schema: SchemaRegistration<IO, Definition, Properties> & EventInputsGuard<IO>,
    ) => Effect.Effect<void>;
  };
  readonly conversion: {
    /** At least one endpoint must be a type this module declares; checked when it mounts. */
    readonly register: (conversion: Conversion.Conversion) => Effect.Effect<void>;
  };
};

export interface RegisteredScalarProperty {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly type: t.Scalar;
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
  readonly internal?: boolean;
  readonly name: string;
  readonly description?: string;
  readonly type: "base" | "event" | "exec" | "pure";
  readonly replay: Replay;
  readonly properties: ReadonlyArray<RegisteredProperty>;
  readonly dataInputs: ReadonlyArray<DataInputRef>;
  readonly dataOutputs: ReadonlyArray<DataOutputRef>;
  readonly executionInputs: ReadonlyArray<ExecutionInputRef>;
  readonly executionOutputs: ReadonlyArray<ExecutionOutputRef>;
  readonly generateIO: (
    properties: Readonly<Record<string, unknown>>,
    types?: RuntimeTypes,
  ) => RegisteredNodeIO;
  readonly matches: (
    event: { readonly _tag: string },
    properties: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<boolean>;
  readonly run: (context: {
    /** Required by schemas that inspect inferred types (e.g. JSON conversion). */
    readonly types?: RuntimeTypes;
    readonly input: (ref: DataInputRef) => unknown;
    readonly scopeInput?: (ref: ExecutionInputRef) => unknown;
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

const ioContext = (types?: RuntimeTypes): IOContext<Readonly<Record<string, unknown>>> => ({
  wildcard: (id) => {
    const wildcard = t.Wildcard(id);
    if (types === undefined) return wildcard;
    const resolved = types.resolve(wildcard);
    return t.Wildcard(
      id,
      resolved._tag === "Wildcard" ? undefined : t.hydrate(resolved, types.definitions),
    );
  },
  data: {
    in: (id, type, options) =>
      new DataInputRef(id, type, options?.name, options?.defaultValue, options?.suggestions),
    out: (id, type, options) => new DataOutputRef(id, type, options?.name),
  },
  exec: {
    in: (id, options) => new ExecutionInputRef(id, options?.name),
    out: (id, options) => new ExecutionOutputRef(id, options?.name),
  },
  scope: {
    in: (id, fields, options) => new ScopeInputRef(id, scopeFields(fields), options?.name),
    out: (id, fields, options) => new ScopeOutputRef(id, scopeFields(fields), options?.name),
  },
});

const collectRefs = (value: unknown): ReadonlyArray<IORef> => {
  if (isPort(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(collectRefs);
  return [];
};

type IORef = PortRef;

function materialize<Value>(
  value: Value,
  context: Parameters<RegisteredSchema["run"]>[0],
): Materialized<Value>;
function materialize(value: unknown, context: Parameters<RegisteredSchema["run"]>[0]): unknown {
  if (isScopeInput(value)) return context.scopeInput?.(value);
  if (isScopeOutput(value))
    return (payload: Readonly<Record<string, unknown>>) => new ScopeExecution(value, payload);
  if (isDataInput(value)) return context.input(value);
  if (isDataOutput(value)) return (output: unknown) => context.output(value, output);
  if (isPort(value)) return value;
  if (t.isType(value)) return value;
  if (Array.isArray(value)) return value.map((item) => materialize(item, context));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materialize(item, context)]),
    );
  return value;
}

/** Event nodes start executions, so nothing can flow into them: they declare outputs only. */
export class EventInputsError extends Error {
  constructor(
    readonly schemaId: string,
    readonly inputs: ReadonlyArray<DataInputRef | ExecutionInputRef>,
  ) {
    super(
      `Event schema "${schemaId}" declares inputs (${inputs.map((input) => input.id).join(", ")}); event nodes can only have outputs`,
    );
    this.name = "EventInputsError";
  }
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
  const generate = (properties: Readonly<Record<string, unknown>>, types?: RuntimeTypes) => {
    const refs = collectRefs(
      schema.io(
        ioContext(types) as IOContext<
          RuntimeProperties<Properties>,
          Engine.RuntimeClientOf<Definition>
        >,
        withDefaults(properties),
      ),
    );
    const executionInputs = refs.filter(isExecutionInput);
    const executionOutputs = refs.filter(isExecutionOutput);
    if (type === "event") {
      const inputs = refs.filter((ref) => isDataInput(ref) || isExecutionInput(ref));
      if (inputs.length > 0) throw new EventInputsError(schema.id, inputs);
    }
    if (type === "exec" && !executionInputs.some((input) => input.id === "exec"))
      executionInputs.unshift(new ExecutionInputRef("exec"));
    if (
      (type === "exec" || type === "event") &&
      !executionOutputs.some((output) => output.id === "exec")
    )
      executionOutputs.unshift(new ExecutionOutputRef("exec"));
    return {
      dataInputs: refs.filter(isDataInput),
      dataOutputs: refs.filter(isDataOutput),
      executionInputs,
      executionOutputs,
    };
  };
  const initial = generate(withDefaults({}));

  return {
    id: schema.id,
    internal: schema.internal ?? false,
    name: schema.name ?? schema.id,
    ...(schema.description === undefined ? {} : { description: schema.description }),
    type,
    replay: schema.replay ?? "unsafe",
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
        ioContext(context.types) as IOContext<
          RuntimeProperties<Properties>,
          Engine.RuntimeClientOf<Definition>
        >,
        withDefaults(context.properties),
      );
      return schema.run({
        io: materialize(io, context),
        get types() {
          if (context.types === undefined)
            throw new Error("Runtime type resolution is unavailable");
          return context.types;
        },
        properties: withDefaults(context.properties),
        event: context.event as Engine.EventOf<Definition> | undefined,
        engine: context.engine as Engine.RuntimeClientOf<Definition>,
        execution: context.execution,
        node: context.node,
      });
    },
  };
};

export interface Collected {
  readonly schemas: ReadonlyArray<RegisteredSchema>;
  readonly conversions: ReadonlyArray<Conversion.Conversion>;
  /** The module's own type definitions, keyed by their module-scoped ids. */
  readonly types: t.Definitions;
}

const scopeSchema = (schema: RegisteredSchema, scope: TypeScope.TypeScope): RegisteredSchema => {
  const field = (item: ScopeField): ScopeField => ({ ...item, type: scope.qualifyType(item.type) });
  const ports = (io: RegisteredNodeIO): RegisteredNodeIO => ({
    dataInputs: io.dataInputs.map(
      (ref) =>
        new DataInputRef(
          ref.id,
          scope.qualifyType(ref.type),
          ref.name,
          ref.defaultValue === undefined ? undefined : scope.qualifyValue(ref.defaultValue),
          ref.suggestions,
        ),
    ),
    dataOutputs: io.dataOutputs.map(
      (ref) => new DataOutputRef(ref.id, scope.qualifyType(ref.type), ref.name),
    ),
    executionInputs: io.executionInputs.map(
      (ref) => new ExecutionInputRef(ref.id, ref.name, ref.scope?.map(field) ?? ref.scope),
    ),
    executionOutputs: io.executionOutputs.map(
      (ref) => new ExecutionOutputRef(ref.id, ref.name, ref.scope?.map(field)),
    ),
  });
  const localTypes = (types: RuntimeTypes | undefined): RuntimeTypes | undefined =>
    types === undefined
      ? undefined
      : {
          resolve: (type) => scope.localizeType(types.resolve(scope.qualifyType(type))),
          definitions: scope.localDefinitions(types.definitions),
        };
  const qualifyPayload = (payload: Readonly<Record<string, unknown>>) =>
    Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, scope.qualifyValue(value)]),
    );
  return {
    ...schema,
    ...ports(schema),
    generateIO: (properties, types) => ports(schema.generateIO(properties, localTypes(types))),
    run: (context) => {
      const types = localTypes(context.types);
      const scopeInput = context.scopeInput;
      return schema
        .run({
          ...context,
          ...(types === undefined ? {} : { types }),
          input: (ref) => scope.localizeValue(context.input(ref)),
          ...(scopeInput === undefined
            ? {}
            : { scopeInput: (ref: ExecutionInputRef) => scope.localizeValue(scopeInput(ref)) }),
          output: (ref, value) => context.output(ref, scope.qualifyValue(value)),
        })
        .pipe(
          Effect.map((selected) =>
            isScopeExecution(selected)
              ? new ScopeExecution(selected, qualifyPayload(selected.payload))
              : selected,
          ),
        );
    },
  };
};

const scopeConversion = (
  conversion: Conversion.Conversion,
  scope: TypeScope.TypeScope,
): Conversion.Conversion => ({
  from: scope.qualifyType(conversion.from),
  to: scope.qualifyType(conversion.to),
  convert: (value) =>
    conversion.convert(scope.localizeValue(value)).pipe(Effect.map(scope.qualifyValue)),
});

/**
 * Runs a module's registration effect. When the module id is given, the types the module declares
 * are scoped to it: ports, conversions and definitions use `<moduleId>/<local id>`, while the
 * module's own code keeps seeing its local ids.
 */
export const collectModule = <Definition extends Engine.AnyDef>(
  effect: (context: ModuleContext<Definition>) => Effect.Effect<void>,
  options?: { readonly moduleId: ModuleId.Id; readonly types?: t.Definitions },
): Effect.Effect<Collected> =>
  Effect.gen(function* () {
    const schemas = yield* Ref.make<ReadonlyArray<RegisteredSchema>>([]);
    const conversions = yield* Ref.make<ReadonlyArray<Conversion.Conversion>>([]);
    const context: ModuleContext<Definition> = {
      schema: {
        register: (schema) =>
          Effect.suspend(() => {
            const registered = makeRegistered(schema);
            return Ref.update(schemas, (current) => [
              ...current.filter((item) => item.id !== schema.id),
              registered,
            ]);
          }),
      },
      conversion: {
        register: (conversion) =>
          Ref.update(conversions, (registered) => [...registered, conversion]),
      },
    };
    yield* effect(context);
    const scope =
      options === undefined ? undefined : TypeScope.make(options.moduleId, options.types);
    const collected = {
      schemas: yield* Ref.get(schemas),
      conversions: yield* Ref.get(conversions),
    };
    return scope === undefined
      ? { ...collected, types: {} }
      : {
          schemas: collected.schemas.map((schema) => scopeSchema(schema, scope)),
          conversions: collected.conversions.map((conversion) =>
            scopeConversion(conversion, scope),
          ),
          types: scope.definitions,
        };
  });

export const collect = <Definition extends Engine.AnyDef>(
  effect: (context: ModuleContext<Definition>) => Effect.Effect<void>,
): Effect.Effect<ReadonlyArray<RegisteredSchema>> =>
  Effect.map(collectModule(effect), (collected) => collected.schemas);
