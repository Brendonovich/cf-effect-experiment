import { DataType } from "@macrograph/module/DataType";
import * as Registration from "@macrograph/module/Registration";
import { Effect, Option, Result, Schema } from "effect";

import type { Graph } from "./Graph.ts";
import type { Node } from "./Node.ts";
import type * as Package from "./Package.ts";
import type * as SchemaAuthoring from "./SchemaAuthoring.ts";

import { IoId, type NodeIO } from "./IO.ts";
import { PackageId, SchemaId, type SchemaRef } from "./SchemaRef.ts";
import { executionPort } from "./Scopes.ts";

export const packageId = PackageId.make("CustomTypes");
export const breakWildcard = DataType.Wildcard("Struct");
export const isBreakStruct = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && node.schema.schema === "BreakStruct";

export class CodecError extends Schema.TaggedError<CodecError>()("CustomTypeCodecError", {
  typeId: Schema.String,
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

/** Operation identities are fixed; Break Struct infers its target, others select it. */
export const operations = [
  { id: "MakeStruct", name: "Make Struct", kind: "Struct" },
  { id: "BreakStruct", name: "Break Struct", kind: "Struct" },
  { id: "UpdateStruct", name: "Update Struct", kind: "Struct" },
  { id: "ConstructEnum", name: "Construct Enum", kind: "Enum" },
  { id: "MatchEnum", name: "Match Enum", kind: "Enum" },
  { id: "ParseJson", name: "Parse JSON", kind: undefined },
  { id: "StringifyJson", name: "Stringify JSON", kind: undefined },
] as const;
type Operation = (typeof operations)[number];

export const operationFor = (id: string) => operations.find((operation) => operation.id === id);
const fieldId = (name: string) => `field:${JSON.stringify(name)}`;
const variantId = (name: string) => `variant:${JSON.stringify(name)}`;
const emptyIO: Registration.RegisteredNodeIO = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [],
  executionOutputs: [],
};

export const selectionError = (
  schema: string,
  properties: Readonly<Record<string, unknown>>,
  definitions: DataType.Definitions,
): string | undefined => {
  const operation = operationFor(schema);
  if (operation === undefined) return;
  if (operation.id === "BreakStruct") return;
  const id = properties.type;
  if (typeof id !== "string" || id === "") return "Select a target type";
  const definition = Object.hasOwn(definitions, id) ? definitions[id] : undefined;
  if (definition === undefined || definition.id !== id) return `Missing type ${id}`;
  if (operation.kind !== undefined && definition._tag !== operation.kind)
    return `Selected type must be a ${operation.kind}`;
  if (operation.id === "ConstructEnum" && definition._tag === "Enum") {
    if (typeof properties.variant !== "string" || properties.variant === "")
      return "Select an enum variant";
    if (!definition.variants.some((variant) => variant.name === properties.variant))
      return `Missing variant ${properties.variant}`;
  }
};

/** Resolves only the selected definition. Codecs remain lazy until execution. */
const resolve = (
  operation: Operation,
  properties: Readonly<Record<string, unknown>>,
  definitions: DataType.Definitions,
): Registration.RegisteredNodeIO & { readonly run: Registration.RegisteredSchema["run"] } => {
  if (operation.id === "BreakStruct") {
    const input = new Registration.DataInputRef("value", breakWildcard);
    return {
      ...emptyIO,
      dataInputs: [input],
      run: (context) =>
        Effect.gen(function* () {
          const type = context.types?.resolve(breakWildcard);
          const definition = type?._tag === "Custom" ? definitions[type.id] : undefined;
          if (type === undefined || definition?._tag !== "Struct")
            return yield* Effect.fail(new Error("Break Struct requires an inferred struct input"));
          const value = yield* Schema.decodeUnknownEffect(DataType.ValueSchema(type, definitions))(
            context.input(input),
          );
          if (typeof value !== "object" || value === null) return;
          const fields = new Map(Object.entries(value));
          for (const field of definition.fields)
            context.output(
              new Registration.DataOutputRef(fieldId(field.name), field.type, field.name),
              fields.get(field.name),
            );
        }),
    };
  }
  const error = selectionError(operation.id, properties, definitions);
  if (error !== undefined) throw new Error(error);
  const id = properties.type;
  if (typeof id !== "string") throw new Error("Select a target type");
  const definition = definitions[id]!;
  const type = DataType.Custom(definition.id);
  const codec = Schema.suspend(() => DataType.ValueSchema(type, definitions));
  const jsonCodec = Schema.suspend(() => DataType.JsonValueSchema(type, definitions));
  const input = new Registration.DataInputRef("value", type);
  const output = new Registration.DataOutputRef(
    "value",
    type,
    operation.id === "ConstructEnum" && typeof properties.variant === "string"
      ? properties.variant
      : undefined,
  );
  const pure = (
    dataInputs: ReadonlyArray<Registration.DataInputRef>,
    dataOutputs: ReadonlyArray<Registration.DataOutputRef>,
    run: Registration.RegisteredSchema["run"],
  ) => ({ ...emptyIO, dataInputs, dataOutputs, run });

  switch (operation.id) {
    case "MakeStruct":
    case "ConstructEnum": {
      const variant =
        definition._tag === "Enum"
          ? definition.variants.find((variant) => variant.name === properties.variant)
          : undefined;
      const fields = definition._tag === "Struct" ? definition.fields : variant!.fields;
      const inputs = fields.map(
        (field) => new Registration.DataInputRef(fieldId(field.name), field.type, field.name),
      );
      return pure(inputs, [output], (context) =>
        Effect.gen(function* () {
          const value = {
            ...Object.fromEntries(
              fields.map((field, index) => [field.name, context.input(inputs[index]!)]),
            ),
            _type: id,
            ...(variant === undefined ? {} : { _tag: variant.name }),
          };
          context.output(output, yield* Schema.decodeUnknownEffect(codec)(value));
        }),
      );
    }
    case "UpdateStruct": {
      if (definition._tag !== "Struct") throw new Error("Expected a Struct");
      const replacements = definition.fields.map(
        (field) =>
          new Registration.DataInputRef(
            fieldId(field.name),
            DataType.Option(field.type),
            field.name,
            Option.none(),
          ),
      );
      return pure([input, ...replacements], [output], (context) =>
        Effect.gen(function* () {
          const original = yield* Schema.decodeUnknownEffect(codec)(context.input(input));
          if (typeof original !== "object" || original === null) return;
          const changes: Record<string, unknown> = {};
          for (const [index, field] of definition.fields.entries()) {
            const replacement = yield* Schema.decodeUnknownEffect(
              Schema.Option(DataType.ValueSchema(field.type, definitions)),
            )(context.input(replacements[index]!));
            if (Option.isSome(replacement)) changes[field.name] = replacement.value;
          }
          context.output(
            output,
            yield* Schema.decodeUnknownEffect(codec)({ ...original, ...changes }),
          );
        }),
      );
    }
    case "MatchEnum": {
      if (definition._tag !== "Enum") throw new Error("Expected an Enum");
      const branches = definition.variants.map((variant) => ({
        variant,
        exec:
          variant.fields.length === 0
            ? new Registration.ExecutionOutputRef(variantId(variant.name), variant.name)
            : new Registration.ScopeOutputRef(
                variantId(variant.name),
                variant.fields.map((field) => ({
                  id: fieldId(field.name),
                  name: field.name,
                  type: field.type,
                })),
                variant.name,
              ),
      }));
      return {
        dataInputs: [input],
        dataOutputs: [],
        executionInputs: [new Registration.ExecutionInputRef("exec")],
        executionOutputs: branches.map((branch) => branch.exec),
        run: (context) =>
          Effect.gen(function* () {
            const value = yield* Schema.decodeUnknownEffect(codec)(context.input(input));
            if (typeof value !== "object" || value === null || !("_tag" in value)) return;
            const branch = branches.find((branch) => branch.variant.name === value._tag)!;
            const fields = new Map(Object.entries(value));
            return branch.exec.scope === undefined
              ? branch.exec
              : new Registration.ScopeExecution(
                  branch.exec,
                  Object.fromEntries(
                    branch.variant.fields.map((field) => [
                      fieldId(field.name),
                      fields.get(field.name),
                    ]),
                  ),
                );
          }),
      };
    }
    case "ParseJson": {
      const json = new Registration.DataInputRef("json", DataType.String, "JSON");
      return pure([json], [output], (context) =>
        Effect.gen(function* () {
          const text = yield* Schema.decodeUnknownEffect(Schema.String)(context.input(json));
          const parsed: unknown = yield* Effect.try({
            try: () => JSON.parse(text),
            catch: (cause) => cause,
          });
          context.output(output, yield* Schema.decodeUnknownEffect(jsonCodec)(parsed));
        }),
      );
    }
    case "StringifyJson": {
      const json = new Registration.DataOutputRef("json", DataType.String, "JSON");
      return pure([input], [json], (context) =>
        Effect.gen(function* () {
          const encoded = yield* Schema.encodeUnknownEffect(jsonCodec)(context.input(input));
          const text = yield* Effect.try({
            try: () => JSON.stringify(encoded),
            catch: (cause) => cause,
          });
          context.output(json, text);
        }),
      );
    }
  }
};

const propertiesFor = (operation: Operation) =>
  operation.id === "BreakStruct"
    ? []
    : [
        {
          id: "type",
          name: "Type",
          type: DataType.String,
          optional: false,
          defaultValue: "",
          ...(operation.id === "UpdateStruct"
            ? { description: "None keeps a field unchanged. Some replaces its value." }
            : {}),
        },
        ...(operation.id === "ConstructEnum"
          ? [
              {
                id: "variant",
                name: "Variant",
                type: DataType.String,
                optional: false,
                defaultValue: "",
              },
            ]
          : []),
      ];

export const schemas = (
  definitions: DataType.Definitions,
): ReadonlyMap<string, Registration.RegisteredSchema> =>
  new Map(
    operations.map((operation) => [
      operation.id,
      {
        id: operation.id,
        name: operation.name,
        description:
          operation.id === "BreakStruct"
            ? "Infers a struct from its input and exposes its fields."
            : operation.id === "UpdateStruct"
              ? "Updates any subset of fields immutably. None keeps the original; Some replaces it."
              : `${operation.name} using the selected project type.`,
        type: operation.id === "MatchEnum" ? "base" : "pure",
        properties: propertiesFor(operation),
        ...emptyIO,
        dataInputs:
          operation.id === "BreakStruct"
            ? [new Registration.DataInputRef("value", breakWildcard)]
            : [],
        executionInputs:
          operation.id === "MatchEnum" ? [new Registration.ExecutionInputRef("exec")] : [],
        generateIO: (properties) => {
          const { run: _, ...io } = resolve(operation, properties, definitions);
          return io;
        },
        matches: () => Effect.succeed(false),
        run: (context) =>
          Effect.suspend(() =>
            resolve(operation, context.properties, definitions).run(context),
          ).pipe(
            Effect.catchCause(
              (cause) =>
                new CodecError({
                  typeId: String(context.properties.type ?? ""),
                  operation: operation.id,
                  cause,
                }),
            ),
          ),
      },
    ]),
  );

const modelIO = (io: Registration.RegisteredNodeIO): NodeIO => ({
  dataInputs: io.dataInputs.map((port) => ({
    id: IoId.make(port.id),
    type: port.type,
    ...(port.name === undefined ? {} : { name: port.name }),
    // Update fields are the only declared defaults. Do not resolve codecs while generating IO:
    // dependent definitions may be missing, and the editor must still render repairable pins.
    ...(port.defaultValue === undefined ? {} : { defaultValue: { _tag: "None" } }),
  })),
  dataOutputs: io.dataOutputs.map((port) => ({
    id: IoId.make(port.id),
    type: port.type,
    ...(port.name === undefined ? {} : { name: port.name }),
  })),
  executionInputs: io.executionInputs.map(executionPort),
  executionOutputs: io.executionOutputs.map(executionPort),
});

export const packageModel: Package.Model = {
  id: packageId,
  name: "Custom Types",
  resources: [],
  schemas: Array.from(schemas({}).values(), (schema) => ({
    id: SchemaId.make(schema.id),
    name: schema.name,
    type: schema.type,
    ...(schema.description === undefined ? {} : { description: schema.description }),
    properties: propertiesFor(operationFor(schema.id)!),
    ...modelIO(schema),
  })),
};

export const nodeIO = (
  ref: SchemaRef,
  properties: Readonly<Record<string, unknown>>,
  definitions: DataType.Definitions,
): NodeIO | undefined => {
  if (ref.package !== packageId) return undefined;
  const operation = operationFor(ref.schema);
  if (operation === undefined || selectionError(ref.schema, properties, definitions) !== undefined)
    return undefined;
  return modelIO(resolve(operation, properties, definitions));
};

/** Registered once. All project-dependent work reads the supplied authoring context. */
export const authoring: Readonly<Record<string, SchemaAuthoring.Definition>> = Object.fromEntries(
  operations.map((operation) => [
    operation.id,
    {
      properties:
        operation.id === "BreakStruct"
          ? {}
          : {
              type: {
                ariaLabel: "Target type",
                placeholder: "Select a type",
                unavailableLabel: "No matching types",
                options: ({ definitions }) =>
                  Object.values(definitions)
                    .filter(
                      (definition) =>
                        operation.kind === undefined || definition._tag === operation.kind,
                    )
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((definition) => ({ id: definition.id, name: definition.name })),
              },
              ...(operation.id === "ConstructEnum"
                ? {
                    variant: {
                      ariaLabel: "Enum variant",
                      placeholder: "Select a variant",
                      unavailableLabel: "Select an enum type first",
                      options: ({ properties, definitions }: SchemaAuthoring.Context) => {
                        const id = properties.type;
                        const definition =
                          typeof id === "string" && Object.hasOwn(definitions, id)
                            ? definitions[id]
                            : undefined;
                        return definition?._tag === "Enum"
                          ? definition.variants.map((variant) => ({
                              id: variant.name,
                              name: variant.name,
                            }))
                          : [];
                      },
                    },
                  }
                : {}),
            },
      ...(operation.id === "BreakStruct"
        ? {
            acceptsInput: (_input, type, definitions) =>
              type._tag === "Wildcard" ||
              (type._tag === "Custom" &&
                (definitions === undefined || definitions[type.id]?._tag === "Struct")),
          }
        : {}),
      generateIO: (context) => {
        if (operation.id === "BreakStruct") {
          const type = context.resolve(breakWildcard);
          const io = modelIO(resolve(operation, context.properties, context.definitions));
          if (type._tag === "Wildcard") return Result.succeed(io);
          if (type._tag !== "Custom") return Result.fail("Break Struct requires a struct input");
          const definition = context.definitions[type.id];
          if (definition === undefined) return Result.fail(`Missing type ${type.id}`);
          if (definition._tag !== "Struct")
            return Result.fail("Break Struct requires a struct input");
          return Result.succeed({
            ...io,
            dataOutputs: definition.fields.map((field) => ({
              id: IoId.make(fieldId(field.name)),
              name: field.name,
              type: field.type,
            })),
          });
        }
        const error = selectionError(operation.id, context.properties, context.definitions);
        return error === undefined
          ? Result.succeed(modelIO(resolve(operation, context.properties, context.definitions)))
          : Result.fail(error);
      },
    } satisfies SchemaAuthoring.Definition,
  ]),
);

/** Output declarations derived from the solved input, never a persisted Type property. */
export const derivedOutputs = (graph: Graph.Model, definitions: DataType.Definitions) => ({
  key: JSON.stringify([
    definitions,
    Object.values(graph.nodes)
      .filter(isBreakStruct)
      .map((node) => node.id)
      .sort(),
  ]),
  outputs: (
    nodeId: string,
    resolve: (type: DataType.Any) => DataType.Any,
  ): Result.Result<NodeIO["dataOutputs"] | undefined, string> => {
    const node = graph.nodes[nodeId];
    if (node === undefined || !isBreakStruct(node)) return Result.succeed(undefined);
    return Result.map(
      authoring.BreakStruct!.generateIO!({
        properties: node.properties,
        definitions,
        resolve,
        declared: modelIO(emptyIO),
        inputScope: () => undefined,
      }),
      (io) => io.dataOutputs,
    );
  },
});

export * as CustomTypes from "./CustomTypes.ts";
