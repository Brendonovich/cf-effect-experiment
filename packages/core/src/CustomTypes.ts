import { DataType } from "@macrograph/module/DataType";
import * as Registration from "@macrograph/module/Registration";
import { Effect, Option, Result, Schema } from "effect";

import type { Canvas } from "./Canvas.ts";
import type { Node } from "./Node.ts";
import type * as Package from "./Package.ts";
import type * as SchemaAuthoring from "./SchemaAuthoring.ts";

import { IoId, type NodeIO } from "./IO.ts";
import { PackageId, SchemaId, type SchemaRef } from "./SchemaRef.ts";
import { executionPort } from "./Scopes.ts";

export const packageId = PackageId.make("CustomTypes");
export const breakWildcard = DataType.Wildcard("Struct");
export const makeWildcard = DataType.Wildcard("Struct");
const wildcardFor = (operation: Operation) =>
  operation.kind === "Struct"
    ? DataType.Wildcard("Struct")
    : operation.kind === "Enum"
      ? DataType.Wildcard("Enum")
      : DataType.Wildcard("Type");
export const isBreakStruct = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && node.schema.schema === "BreakStruct";
export const isMakeStruct = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && node.schema.schema === "MakeStruct";
export const isOperationNode = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && operationFor(node.schema.schema) !== undefined;

export class CodecError extends Schema.TaggedError<CodecError>()("CustomTypeCodecError", {
  typeId: Schema.String,
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

/** Operation identities are fixed; Make/Break Struct infer their targets, others select them. */
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
  _definitions: DataType.Definitions,
): string | undefined => {
  const operation = operationFor(schema);
  if (operation === undefined) return;
  if (operation.id === "ConstructEnum") {
    if (typeof properties.variant !== "string" || properties.variant === "")
      return "Select an enum variant";
  }
};

const inferenceError = (
  operation: Operation,
  type: DataType.Any,
  definitions: DataType.Definitions,
): string | undefined => {
  if (type._tag === "Wildcard") return;
  if (type._tag !== "Custom") return `${operation.name} requires an inferred custom type`;
  const definition = definitions[type.id];
  if (definition === undefined) return `Missing type ${type.id}`;
  if (operation.kind !== undefined && definition._tag !== operation.kind)
    return `${operation.name} requires an inferred ${operation.kind.toLowerCase()}`;
};

/** Resolves only the inferred definition. Codecs remain lazy until execution. */
const resolve = (
  operation: Operation,
  properties: Readonly<Record<string, unknown>>,
  definitions: DataType.Definitions,
  inferred?: DataType.Any,
): Registration.RegisteredNodeIO & { readonly run: Registration.RegisteredSchema["run"] } => {
  const wildcard = wildcardFor(operation);
  const valueInput = new Registration.DataInputRef("value", wildcard);
  const valueOutput = new Registration.DataOutputRef(
    "value",
    wildcard,
    operation.id === "ConstructEnum" && typeof properties.variant === "string"
      ? properties.variant
      : undefined,
  );
  const jsonInput = new Registration.DataInputRef("json", DataType.String, "JSON");
  const jsonOutput = new Registration.DataOutputRef("json", DataType.String, "JSON");
  const execInput = new Registration.ExecutionInputRef("exec");
  const unresolved = (): Registration.RegisteredNodeIO & {
    readonly run: Registration.RegisteredSchema["run"];
  } => {
    const run = () => Effect.void;
    switch (operation.id) {
      case "MakeStruct":
      case "ConstructEnum":
        return { ...emptyIO, dataOutputs: [valueOutput], run };
      case "BreakStruct":
      case "StringifyJson":
        return {
          ...emptyIO,
          dataInputs: [valueInput],
          ...(operation.id === "StringifyJson" ? { dataOutputs: [jsonOutput] } : {}),
          run,
        };
      case "UpdateStruct":
        return { ...emptyIO, dataInputs: [valueInput], dataOutputs: [valueOutput], run };
      case "MatchEnum":
        return { ...emptyIO, dataInputs: [valueInput], executionInputs: [execInput], run };
      case "ParseJson":
        return { ...emptyIO, dataInputs: [jsonInput], dataOutputs: [valueOutput], run };
    }
    throw new Error("Unknown custom type operation");
  };
  const inferredType = inferred ?? wildcard;
  if (inferredType._tag === "Wildcard") return unresolved();
  const inferredError = inferenceError(operation, inferredType, definitions);
  if (inferredError !== undefined) throw new Error(inferredError);
  if (inferredType._tag !== "Custom") throw new Error(`${operation.name} requires a custom type`);
  const definition = definitions[inferredType.id]!;
  const id = definition.id;
  const codecType = DataType.Custom(definition.id);
  const codec = Schema.suspend(() => DataType.ValueSchema(codecType, definitions));
  const jsonCodec = Schema.suspend(() => DataType.JsonValueSchema(codecType, definitions));
  const input = valueInput;
  const output = valueOutput;
  const pure = (
    dataInputs: ReadonlyArray<Registration.DataInputRef>,
    dataOutputs: ReadonlyArray<Registration.DataOutputRef>,
    run: Registration.RegisteredSchema["run"],
  ) => ({ ...emptyIO, dataInputs, dataOutputs, run });

  switch (operation.id) {
    case "MakeStruct": {
      if (definition._tag !== "Struct") throw new Error("Expected a Struct");
      const inputs = definition.fields.map(
        (field) => new Registration.DataInputRef(fieldId(field.name), field.type, field.name),
      );
      return pure(inputs, [output], (context) =>
        Effect.gen(function* () {
          const value = {
            ...Object.fromEntries(
              definition.fields.map((field, index) => [field.name, context.input(inputs[index]!)]),
            ),
            _type: definition.id,
          };
          context.output(output, yield* Schema.decodeUnknownEffect(codec)(value));
        }),
      );
    }
    case "BreakStruct": {
      if (definition._tag !== "Struct") throw new Error("Expected a Struct");
      const outputs = definition.fields.map(
        (field) => new Registration.DataOutputRef(fieldId(field.name), field.type, field.name),
      );
      return pure([input], outputs, (context) =>
        Effect.gen(function* () {
          const value = yield* Schema.decodeUnknownEffect(codec)(context.input(input));
          if (typeof value !== "object" || value === null) return;
          const fields = new Map(Object.entries(value));
          for (const [index, field] of definition.fields.entries())
            context.output(outputs[index]!, fields.get(field.name));
        }),
      );
    }
    case "ConstructEnum": {
      if (definition._tag !== "Enum") throw new Error("Expected an Enum");
      const variant =
        typeof properties.variant === "string"
          ? definition.variants.find((variant) => variant.name === properties.variant)
          : undefined;
      if (variant === undefined) throw new Error("Select an enum variant");
      const fields = variant.fields;
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
  throw new Error("Unknown custom type operation");
};

const propertiesFor = (operation: Operation) =>
  operation.id === "ConstructEnum"
    ? [
        {
          id: "variant",
          name: "Variant",
          type: DataType.String,
          optional: false,
          defaultValue: "",
        },
      ]
    : [];

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
          operation.id === "BreakStruct" || operation.id === "MakeStruct"
            ? `Infers a struct from its ${operation.id === "MakeStruct" ? "output" : "input"} and ${
                operation.id === "MakeStruct" ? "accepts" : "exposes"
              } its fields.`
            : operation.id === "UpdateStruct"
              ? "Updates any subset of fields immutably. None keeps the original; Some replaces it."
              : `${operation.name} using the type inferred from its wildcard.`,
        type: operation.id === "MatchEnum" ? "base" : "pure",
        properties: propertiesFor(operation),
        ...(() => {
          const { run: _, ...io } = resolve(operation, {}, definitions);
          return io;
        })(),
        generateIO: (properties) => {
          const { run: _, ...io } = resolve(operation, properties, definitions);
          return io;
        },
        matches: () => Effect.succeed(false),
        run: (context) =>
          Effect.suspend(() =>
            resolve(
              operation,
              context.properties,
              definitions,
              context.types?.resolve(wildcardFor(operation)),
            ).run(context),
          ).pipe(
            Effect.catchCause(
              (cause) =>
                new CodecError({
                  typeId: (() => {
                    const type = context.types?.resolve(wildcardFor(operation));
                    return type?._tag === "Custom" ? type.id : "";
                  })(),
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
  if (operation === undefined) return undefined;
  return modelIO(resolve(operation, properties, definitions));
};

/** Registered once. All project-dependent work reads the supplied authoring context. */
export const authoring: Readonly<Record<string, SchemaAuthoring.Definition>> = Object.fromEntries(
  operations.map((operation) => [
    operation.id,
    {
      properties:
        operation.id === "ConstructEnum"
          ? {
              variant: {
                ariaLabel: "Enum variant",
                placeholder: "Select a variant",
                unavailableLabel: "Connect the output to infer an enum first",
                options: ({ io, definitions }: SchemaAuthoring.Context) => {
                  const type = io?.dataOutputs.find((output) => output.id === "value")?.type;
                  const definition = type?._tag === "Custom" ? definitions[type.id] : undefined;
                  return definition?._tag === "Enum"
                    ? definition.variants.map((variant) => ({
                        id: variant.name,
                        name: variant.name,
                      }))
                    : [];
                },
              },
            }
          : {},
      ...(["BreakStruct", "UpdateStruct", "MatchEnum", "StringifyJson"].includes(operation.id)
        ? {
            acceptsInput: (input, type, definitions) =>
              input !== "value" ||
              type._tag === "Wildcard" ||
              (type._tag === "Custom" &&
                (definitions === undefined ||
                  operation.kind === undefined ||
                  definitions[type.id]?._tag === operation.kind)),
          }
        : {}),
      ...(["MakeStruct", "UpdateStruct", "ConstructEnum", "ParseJson"].includes(operation.id)
        ? {
            acceptsOutput: (output, type, definitions) =>
              output !== "value" ||
              type._tag === "Wildcard" ||
              (type._tag === "Custom" &&
                (definitions === undefined ||
                  operation.kind === undefined ||
                  definitions[type.id]?._tag === operation.kind)),
          }
        : {}),
      generateIO: (context) => {
        const type = context.resolve(wildcardFor(operation));
        const error = inferenceError(operation, type, context.definitions);
        if (error !== undefined) return Result.fail(error);
        if (type._tag === "Wildcard")
          return Result.succeed(
            modelIO(resolve(operation, context.properties, context.definitions)),
          );
        if (operation.id === "ConstructEnum") {
          const definition = type._tag === "Custom" ? context.definitions[type.id] : undefined;
          if (
            definition?._tag !== "Enum" ||
            typeof context.properties.variant !== "string" ||
            !definition.variants.some((variant) => variant.name === context.properties.variant)
          )
            return Result.succeed(
              modelIO(resolve(operation, context.properties, context.definitions)),
            );
        }
        return Result.succeed(
          modelIO(resolve(operation, context.properties, context.definitions, type)),
        );
      },
    } satisfies SchemaAuthoring.Definition,
  ]),
);

/** Dynamic declarations derived from solved wildcard pins, never a persisted Type property. */
export const derivedIO = (graph: Canvas.Model, definitions: DataType.Definitions) => ({
  key: JSON.stringify([
    definitions,
    Object.values(graph.nodes)
      .filter((node) => node.schema.package === packageId && operationFor(node.schema.schema))
      .map((node) => node.id)
      .sort(),
  ]),
  ports: (
    nodeId: string,
    resolve: (type: DataType.Any) => DataType.Any,
  ): Result.Result<NodeIO | undefined, string> => {
    const node = graph.nodes[nodeId];
    const operation = node === undefined ? undefined : operationFor(node.schema.schema);
    if (node?.schema.package !== packageId || operation === undefined)
      return Result.succeed(undefined);
    return authoring[operation.id]!.generateIO!({
      properties: node.properties,
      definitions,
      resolve,
      declared: modelIO(emptyIO),
      inputScope: () => undefined,
    });
  },
});

export * as CustomTypes from "./CustomTypes.ts";
