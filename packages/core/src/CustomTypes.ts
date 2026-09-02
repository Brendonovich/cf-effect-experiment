import { DataType } from "@macrograph/plugin/DataType";
import * as Registration from "@macrograph/plugin/Registration";
import { Effect, Schema } from "effect";

import type * as Package from "./Package.ts";

import { IoId, type NodeIO } from "./IO.ts";
import { PackageId, SchemaId, type SchemaRef } from "./SchemaRef.ts";

export const packageId = PackageId.make("CustomTypes");

export class CodecError extends Schema.TaggedError<CodecError>()("CustomTypeCodecError", {
  typeId: Schema.String,
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

/** IDs encode identities, not display names, and remain stable across type renames. */
const schemaId = (id: string, operation: string, member?: string) =>
  SchemaId.make(JSON.stringify(member === undefined ? [id, operation] : [id, operation, member]));
const fieldId = (name: string) => `field:${JSON.stringify(name)}`;
const variantId = (name: string) => `variant:${JSON.stringify(name)}`;

const generateSchemas = (
  definitions: DataType.Definitions,
  selected: ReadonlyArray<DataType.Definition>,
): ReadonlyMap<string, Registration.RegisteredSchema> => {
  const registered = new Map<string, Registration.RegisteredSchema>();
  for (const definition of selected) {
    const type = DataType.Custom(definition.id);
    const valueCodec = Schema.suspend(() => DataType.ValueSchema(type, definitions));
    const jsonCodec = Schema.suspend(() => DataType.JsonValueSchema(type, definitions));
    const add = (
      operation: string,
      name: string,
      description: string,
      io: Registration.RegisteredNodeIO,
      run: Registration.RegisteredSchema["run"],
      member?: string,
    ) => {
      const id = schemaId(definition.id, operation, member);
      registered.set(id, {
        id,
        name,
        description,
        type: io.executionInputs.length === 0 ? "pure" : "exec",
        properties: [],
        ...io,
        generateIO: () => io,
        matches: () => Effect.succeed(false),
        run: (context) =>
          Effect.suspend(() => run(context)).pipe(
            Effect.catchCause(
              (cause) => new CodecError({ typeId: definition.id, operation, cause }),
            ),
          ),
      });
    };
    const pure = (
      dataInputs: ReadonlyArray<Registration.DataInputRef>,
      dataOutputs: ReadonlyArray<Registration.DataOutputRef>,
    ): Registration.RegisteredNodeIO => ({
      dataInputs,
      dataOutputs,
      executionInputs: [],
      executionOutputs: [],
    });
    const input = new Registration.DataInputRef("value", type, definition.name);
    const output = new Registration.DataOutputRef("value", type, definition.name);
    const construct = (fields: ReadonlyArray<typeof DataType.Field.Type>, variant?: string) => {
      const inputs = fields.map(
        (field) => new Registration.DataInputRef(fieldId(field.name), field.type, field.name),
      );
      add(
        variant === undefined ? "make" : "construct",
        variant === undefined
          ? `Make ${definition.name}`
          : `Construct ${definition.name}.${variant}`,
        "Creates a nominally typed value from all declared payload fields.",
        pure(inputs, [output]),
        (context) =>
          Effect.gen(function* () {
            const value = {
              ...Object.fromEntries(
                fields.map((field, index) => [field.name, context.input(inputs[index]!)]),
              ),
              _type: definition.id,
              ...(variant === undefined ? {} : { _tag: variant }),
            };
            const decoded = yield* Schema.decodeUnknownEffect(valueCodec)(value, {
              onExcessProperty: "error",
            });
            context.output(output, decoded);
          }),
        variant,
      );
    };
    if (definition._tag === "Struct") {
      construct(definition.fields);
      const outputs = definition.fields.map(
        (field) => new Registration.DataOutputRef(fieldId(field.name), field.type, field.name),
      );
      add(
        "break",
        `Break ${definition.name}`,
        "Reads each field of a nominally typed struct.",
        pure([input], outputs),
        (context) =>
          Effect.gen(function* () {
            yield* Schema.decodeUnknownEffect(valueCodec)(context.input(input), {
              onExcessProperty: "error",
            });
            const value = context.input(input);
            if (typeof value !== "object" || value === null) return;
            const fields = new Map(Object.entries(value));
            definition.fields.forEach((field, index) =>
              context.output(outputs[index]!, fields.get(field.name)),
            );
          }),
      );
      for (const field of definition.fields) {
        const replacement = new Registration.DataInputRef(
          fieldId(field.name),
          field.type,
          field.name,
        );
        add(
          "update",
          `Update ${definition.name}.${field.name}`,
          "Replaces one field immutably, preserving every other field.",
          pure([input, replacement], [output]),
          (context) =>
            Effect.gen(function* () {
              const original = yield* Schema.decodeUnknownEffect(valueCodec)(context.input(input), {
                onExcessProperty: "error",
              });
              if (typeof original !== "object" || original === null) return;
              const value = yield* Schema.decodeUnknownEffect(valueCodec)(
                { ...original, [field.name]: context.input(replacement) },
                { onExcessProperty: "error" },
              );
              context.output(output, value);
            }),
          field.name,
        );
      }
    } else {
      for (const variant of definition.variants) construct(variant.fields, variant.name);
      const branches = definition.variants.map((variant) => ({
        variant,
        exec: new Registration.ExecutionOutputRef(variantId(variant.name), variant.name),
        outputs: variant.fields.map(
          (field) =>
            new Registration.DataOutputRef(
              `${variantId(variant.name)}/${fieldId(field.name)}`,
              field.type,
              `${variant.name}.${field.name}`,
            ),
        ),
      }));
      add(
        "match",
        `Match ${definition.name}`,
        "Selects a variant execution branch; only that branch's typed payload outputs are available.",
        {
          dataInputs: [input],
          dataOutputs: branches.flatMap((branch) => branch.outputs),
          executionInputs: [new Registration.ExecutionInputRef("exec")],
          executionOutputs: branches.map((branch) => branch.exec),
        },
        (context) =>
          Effect.gen(function* () {
            const value = yield* Schema.decodeUnknownEffect(valueCodec)(context.input(input), {
              onExcessProperty: "error",
            });
            if (typeof value !== "object" || value === null || !("_tag" in value)) return;
            const branch = branches.find((branch) => branch.variant.name === value._tag);
            if (branch === undefined) return;
            const fields = new Map(Object.entries(value));
            branch.variant.fields.forEach((field, index) =>
              context.output(branch.outputs[index]!, fields.get(field.name)),
            );
            return branch.exec;
          }),
      );
    }
    const jsonInput = new Registration.DataInputRef("json", DataType.String, "JSON");
    const jsonOutput = new Registration.DataOutputRef("json", DataType.String, "JSON");
    add(
      "parse",
      `Parse ${definition.name} JSON`,
      "Decodes JSON using the current project codec, including nominal identity and nested types.",
      pure([jsonInput], [output]),
      (context) =>
        Effect.gen(function* () {
          const text = yield* Schema.decodeUnknownEffect(Schema.String)(context.input(jsonInput));
          const json: unknown = yield* Effect.try({
            try: () => JSON.parse(text),
            catch: (cause) => cause,
          });
          const value = yield* Schema.decodeUnknownEffect(jsonCodec)(json, {
            onExcessProperty: "error",
          });
          context.output(output, value);
        }),
    );
    add(
      "stringify",
      `Stringify ${definition.name} JSON`,
      "Encodes a nominal value with the current project codec, including nested List, Option and DateTime values.",
      pure([input], [jsonOutput]),
      (context) =>
        Effect.gen(function* () {
          const json = yield* Schema.encodeUnknownEffect(jsonCodec)(context.input(input), {
            onExcessProperty: "error",
          });
          const text = yield* Effect.try({
            try: () => JSON.stringify(json),
            catch: (cause) => cause,
          });
          context.output(jsonOutput, text);
        }),
    );
  }
  return registered;
};

export const schemas = (
  definitions: DataType.Definitions,
): ReadonlyMap<string, Registration.RegisteredSchema> =>
  generateSchemas(definitions, Object.values(definitions));

const modelIO = (io: Registration.RegisteredNodeIO): NodeIO => ({
  dataInputs: io.dataInputs.map((port) => ({
    id: IoId.make(port.id),
    type: port.type,
    ...(port.name === undefined ? {} : { name: port.name }),
  })),
  dataOutputs: io.dataOutputs.map((port) => ({
    id: IoId.make(port.id),
    type: port.type,
    ...(port.name === undefined ? {} : { name: port.name }),
  })),
  executionInputs: io.executionInputs.map((port) => ({
    id: IoId.make(port.id),
    ...(port.name === undefined ? {} : { name: port.name }),
  })),
  executionOutputs: io.executionOutputs.map((port) => ({
    id: IoId.make(port.id),
    ...(port.name === undefined ? {} : { name: port.name }),
  })),
});

export const packageModel = (definitions: DataType.Definitions): Package.Model => ({
  id: packageId,
  name: "Custom Types",
  resources: [],
  schemas: Array.from(schemas(definitions).values(), (schema) => ({
    id: SchemaId.make(schema.id),
    name: schema.name,
    type: schema.type,
    ...(schema.description === undefined ? {} : { description: schema.description }),
    properties: [],
    ...modelIO(schema),
  })),
});

export const nodeIO = (
  ref: SchemaRef,
  properties: Readonly<Record<string, unknown>>,
  definitions: DataType.Definitions,
): NodeIO | undefined => {
  if (ref.package !== packageId) return undefined;
  let identity: unknown;
  try {
    identity = JSON.parse(ref.schema);
  } catch {
    return undefined;
  }
  if (
    !Array.isArray(identity) ||
    typeof identity[0] !== "string" ||
    !Object.hasOwn(definitions, identity[0])
  )
    return undefined;
  const definition = definitions[identity[0]]!;
  if (definition.id !== identity[0]) return undefined;
  const schema = generateSchemas(definitions, [definition]).get(ref.schema);
  return schema === undefined ? undefined : modelIO(schema.generateIO(properties));
};

export * as CustomTypes from "./CustomTypes.ts";
