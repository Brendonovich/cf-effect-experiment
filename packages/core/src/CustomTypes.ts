import { Module, t } from "@macrograph/module";
import * as Registration from "@macrograph/module/Registration";
import { Effect, Option, Schema } from "effect";

import type { Node } from "./Node.ts";
import type * as Package from "./Package.ts";
import type * as SchemaAuthoring from "./SchemaAuthoring.ts";

import { IoId } from "./IO.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";
import { executionPort } from "./Scopes.ts";

export const packageId = PackageId.make("CustomTypes");
export const breakWildcard = t.Wildcard("Struct");
export const makeWildcard = t.Wildcard("Struct");
export const isBreakStruct = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && node.schema.schema === "BreakStruct";
export const isMakeStruct = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && node.schema.schema === "MakeStruct";
export const isOperationNode = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && isOperationSchema(node.schema.schema);

export class CodecError extends Schema.TaggedError<CodecError>()("CustomTypeCodecError", {
  typeId: Schema.String,
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

export const isOperationSchema = (id: string) =>
  id === "MakeStruct" ||
  id === "BreakStruct" ||
  id === "UpdateStruct" ||
  id === "ConstructEnum" ||
  id === "MatchEnum" ||
  id === "ParseJson" ||
  id === "StringifyJson";

const fieldId = (name: string) => `field:${JSON.stringify(name)}`;
const variantId = (name: string) => `variant:${JSON.stringify(name)}`;
export const selectionError = (
  schema: string,
  properties: Readonly<Record<string, unknown>>,
  _definitions: t.Definitions,
): string | undefined => {
  if (
    schema === "ConstructEnum" &&
    (typeof properties.variant !== "string" || properties.variant === "")
  )
    return "Select an enum variant";
};

export const module = Module.make({
  id: "CustomTypes",
  name: "Custom Types",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "MakeStruct",
      name: "Make Struct",
      description: "Infers a struct from its output and accepts its fields.",
      type: "pure",
      io: (io) => {
        const wildcard = io.wildcard("Struct");
        const resolved = wildcard.value;
        const definition = resolved?._tag === "Custom" ? resolved.definition : undefined;
        return {
          resolved,
          inputs:
            definition?._tag === "Struct"
              ? definition.fields.map((field) =>
                  io.data.in(fieldId(field.name), field.type, { name: field.name }),
                )
              : [],
          output: io.data.out("value", wildcard),
        };
      },
      run: ({ io, types }) =>
        Effect.gen(function* () {
          if (io.resolved === undefined) return;
          if (io.resolved._tag !== "Custom" || io.resolved.definition?._tag !== "Struct")
            return yield* Effect.fail(new Error("Make Struct requires an inferred struct"));
          const definition = io.resolved.definition;
          const value = {
            ...Object.fromEntries(
              definition.fields.map((field, index) => [field.name, io.inputs[index]]),
            ),
            _type: definition.id,
          };
          io.output(
            yield* Schema.decodeUnknownEffect(
              t.ValueSchema(t.Custom(definition.id, definition), types.definitions),
            )(value),
          );
        }).pipe(
          Effect.catchCause(
            (cause) =>
              new CodecError({
                typeId: io.resolved?._tag === "Custom" ? io.resolved.id : "",
                operation: "MakeStruct",
                cause,
              }),
          ),
        ),
    });

    yield* context.schema.register({
      id: "BreakStruct",
      name: "Break Struct",
      description: "Infers a struct from its input and exposes its fields.",
      type: "pure",
      io: (io) => {
        const wildcard = io.wildcard("Struct");
        const resolved = wildcard.value;
        const definition = resolved?._tag === "Custom" ? resolved.definition : undefined;
        return {
          resolved,
          input: io.data.in("value", wildcard),
          outputs:
            definition?._tag === "Struct"
              ? definition.fields.map((field) =>
                  io.data.out(fieldId(field.name), field.type, { name: field.name }),
                )
              : [],
        };
      },
      run: ({ io, types }) =>
        Effect.gen(function* () {
          if (io.resolved === undefined) return;
          if (io.resolved._tag !== "Custom" || io.resolved.definition?._tag !== "Struct")
            return yield* Effect.fail(new Error("Break Struct requires an inferred struct"));
          const definition = io.resolved.definition;
          const value = yield* Schema.decodeUnknownEffect(
            t.ValueSchema(t.Custom(definition.id, definition), types.definitions),
          )(io.input);
          if (typeof value !== "object" || value === null) return;
          const fields = Object.fromEntries(Object.entries(value));
          for (const [index, field] of definition.fields.entries())
            io.outputs[index]?.(fields[field.name]);
        }).pipe(
          Effect.catchCause(
            (cause) =>
              new CodecError({
                typeId: io.resolved?._tag === "Custom" ? io.resolved.id : "",
                operation: "BreakStruct",
                cause,
              }),
          ),
        ),
    });

    yield* context.schema.register({
      id: "UpdateStruct",
      name: "Update Struct",
      description:
        "Updates any subset of fields immutably. None keeps the original; Some replaces it.",
      type: "pure",
      io: (io) => {
        const wildcard = io.wildcard("Struct");
        const resolved = wildcard.value;
        const definition = resolved?._tag === "Custom" ? resolved.definition : undefined;
        return {
          resolved,
          input: io.data.in("value", wildcard),
          replacements:
            definition?._tag === "Struct"
              ? definition.fields.map((field) =>
                  io.data.in(fieldId(field.name), t.Option(field.type), {
                    name: field.name,
                    defaultValue: Option.none(),
                  }),
                )
              : [],
          output: io.data.out("value", wildcard),
        };
      },
      run: ({ io, types }) =>
        Effect.gen(function* () {
          if (io.resolved === undefined) return;
          if (io.resolved._tag !== "Custom" || io.resolved.definition?._tag !== "Struct")
            return yield* Effect.fail(new Error("Update Struct requires an inferred struct"));
          const definition = io.resolved.definition;
          const codec = t.ValueSchema(t.Custom(definition.id, definition), types.definitions);
          const original = yield* Schema.decodeUnknownEffect(codec)(io.input);
          if (typeof original !== "object" || original === null) return;
          const changes: Record<string, unknown> = {};
          for (const [index, field] of definition.fields.entries()) {
            const replacement = yield* Schema.decodeUnknownEffect(
              Schema.Option(t.ValueSchema(field.type, types.definitions)),
            )(io.replacements[index]);
            if (Option.isSome(replacement)) changes[field.name] = replacement.value;
          }
          io.output(
            yield* Schema.decodeUnknownEffect(codec)({
              ...Object.fromEntries(Object.entries(original)),
              ...changes,
            }),
          );
        }).pipe(
          Effect.catchCause(
            (cause) =>
              new CodecError({
                typeId: io.resolved?._tag === "Custom" ? io.resolved.id : "",
                operation: "UpdateStruct",
                cause,
              }),
          ),
        ),
    });

    yield* context.schema.register({
      id: "ConstructEnum",
      name: "Construct Enum",
      description: "Construct Enum using the type inferred from its wildcard.",
      type: "pure",
      properties: {
        variant: { name: "Variant", type: t.String, defaultValue: "" },
      },
      io: (io, properties) => {
        const wildcard = io.wildcard("Enum");
        const resolved = wildcard.value;
        const definition = resolved?._tag === "Custom" ? resolved.definition : undefined;
        const variant =
          definition?._tag === "Enum"
            ? definition.variants.find((candidate) => candidate.name === properties.variant)
            : undefined;
        return {
          resolved,
          variant,
          inputs:
            variant?.fields.map((field) =>
              io.data.in(fieldId(field.name), field.type, { name: field.name }),
            ) ?? [],
          output: io.data.out("value", wildcard, {
            ...(properties.variant === "" ? {} : { name: properties.variant }),
          }),
        };
      },
      run: ({ io, types }) =>
        Effect.gen(function* () {
          if (io.resolved === undefined) return;
          if (
            io.resolved._tag !== "Custom" ||
            io.resolved.definition?._tag !== "Enum" ||
            io.variant === undefined
          )
            return yield* Effect.fail(new Error("Select an enum variant"));
          const definition = io.resolved.definition;
          const value = {
            ...Object.fromEntries(
              io.variant.fields.map((field, index) => [field.name, io.inputs[index]]),
            ),
            _type: definition.id,
            _tag: io.variant.name,
          };
          io.output(
            yield* Schema.decodeUnknownEffect(
              t.ValueSchema(t.Custom(definition.id, definition), types.definitions),
            )(value),
          );
        }).pipe(
          Effect.catchCause(
            (cause) =>
              new CodecError({
                typeId: io.resolved?._tag === "Custom" ? io.resolved.id : "",
                operation: "ConstructEnum",
                cause,
              }),
          ),
        ),
    });

    yield* context.schema.register({
      id: "MatchEnum",
      name: "Match Enum",
      description: "Match Enum using the type inferred from its wildcard.",
      type: "base",
      io: (io) => {
        const wildcard = io.wildcard("Enum");
        const resolved = wildcard.value;
        const definition = resolved?._tag === "Custom" ? resolved.definition : undefined;
        return {
          resolved,
          input: io.data.in("value", wildcard),
          exec: io.exec.in("exec"),
          branches:
            definition?._tag === "Enum"
              ? definition.variants.map((variant) =>
                  variant.fields.length === 0
                    ? {
                        kind: "exec" as const,
                        variant,
                        output: io.exec.out(variantId(variant.name), { name: variant.name }),
                      }
                    : {
                        kind: "scope" as const,
                        variant,
                        output: new Registration.ScopeOutputRef(
                          variantId(variant.name),
                          variant.fields.map((field) => ({
                            id: fieldId(field.name),
                            name: field.name,
                            type: field.type,
                          })),
                          variant.name,
                        ),
                      },
                )
              : [],
        };
      },
      run: ({ io, types }) =>
        Effect.gen(function* () {
          if (io.resolved === undefined) return;
          if (io.resolved._tag !== "Custom" || io.resolved.definition?._tag !== "Enum")
            return yield* Effect.fail(new Error("Match Enum requires an inferred enum"));
          const definition = io.resolved.definition;
          const value = yield* Schema.decodeUnknownEffect(
            t.ValueSchema(t.Custom(definition.id, definition), types.definitions),
          )(io.input);
          if (typeof value !== "object" || value === null || !("_tag" in value)) return;
          const fields = Object.fromEntries(Object.entries(value));
          const branch = io.branches.find((candidate) => candidate.variant.name === fields._tag);
          if (branch === undefined) return;
          if (branch.kind === "exec") return branch.output;
          return branch.output(
            Object.fromEntries(
              branch.variant.fields.map((field) => [fieldId(field.name), fields[field.name]]),
            ),
          );
        }).pipe(
          Effect.catchCause(
            (cause) =>
              new CodecError({
                typeId: io.resolved?._tag === "Custom" ? io.resolved.id : "",
                operation: "MatchEnum",
                cause,
              }),
          ),
        ),
    });

    yield* context.schema.register({
      id: "ParseJson",
      name: "Parse JSON",
      description: "Parse JSON using the type inferred from its wildcard.",
      type: "pure",
      io: (io) => {
        const wildcard = io.wildcard("Type");
        return {
          resolved: wildcard.value,
          json: io.data.in("json", t.String, { name: "JSON" }),
          output: io.data.out("value", wildcard),
        };
      },
      run: ({ io, types }) =>
        Effect.gen(function* () {
          if (io.resolved === undefined) return;
          if (io.resolved._tag !== "Custom" || io.resolved.definition === undefined)
            return yield* Effect.fail(new Error("Parse JSON requires an inferred custom type"));
          const parsed: unknown = yield* Effect.try({
            try: () => JSON.parse(io.json),
            catch: (cause) => cause,
          });
          io.output(
            yield* Schema.decodeUnknownEffect(t.JsonValueSchema(io.resolved, types.definitions))(
              parsed,
            ),
          );
        }).pipe(
          Effect.catchCause(
            (cause) =>
              new CodecError({
                typeId: io.resolved?._tag === "Custom" ? io.resolved.id : "",
                operation: "ParseJson",
                cause,
              }),
          ),
        ),
    });

    yield* context.schema.register({
      id: "StringifyJson",
      name: "Stringify JSON",
      description: "Stringify JSON using the type inferred from its wildcard.",
      type: "pure",
      io: (io) => {
        const wildcard = io.wildcard("Type");
        return {
          resolved: wildcard.value,
          input: io.data.in("value", wildcard),
          json: io.data.out("json", t.String, { name: "JSON" }),
        };
      },
      run: ({ io, types }) =>
        Effect.gen(function* () {
          if (io.resolved === undefined) return;
          if (io.resolved._tag !== "Custom" || io.resolved.definition === undefined)
            return yield* Effect.fail(new Error("Stringify JSON requires an inferred custom type"));
          const encoded = yield* Schema.encodeUnknownEffect(
            t.JsonValueSchema(io.resolved, types.definitions),
          )(io.input);
          io.json(
            yield* Effect.try({
              try: () => JSON.stringify(encoded),
              catch: (cause) => cause,
            }),
          );
        }).pipe(
          Effect.catchCause(
            (cause) =>
              new CodecError({
                typeId: io.resolved?._tag === "Custom" ? io.resolved.id : "",
                operation: "StringifyJson",
                cause,
              }),
          ),
        ),
    });
  }),
});

const registeredSchemas = new Map(
  Effect.runSync(Registration.collect(module.effect)).map((schema) => [schema.id, schema]),
);

export const packageModel: Package.Model = {
  id: packageId,
  name: module.name ?? module.id,
  types: module.types ?? {},
  resources: [],
  schemas: [...registeredSchemas.values()].map((schema) => ({
    id: SchemaId.make(schema.id),
    internal: schema.internal ?? false,
    name: schema.name,
    ...(schema.description === undefined ? {} : { description: schema.description }),
    type: schema.type,
    properties: schema.properties.map((property) =>
      "resource" in property
        ? {
            id: property.id,
            name: property.name,
            ...(property.description === undefined ? {} : { description: property.description }),
            resource: property.resource,
            optional: false,
          }
        : {
            id: property.id,
            name: property.name,
            ...(property.description === undefined ? {} : { description: property.description }),
            type: property.type,
            optional: property.optional,
            ...(property.defaultValue === undefined
              ? {}
              : { defaultValue: Schema.decodeUnknownSync(Schema.Json)(property.defaultValue) }),
          },
    ),
    dataInputs: schema.dataInputs.map((input) => ({
      id: IoId.make(input.id),
      type: input.type,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.defaultValue === undefined
        ? {}
        : { defaultValue: Schema.decodeUnknownSync(Schema.Json)(input.defaultValue) }),
      ...(input.suggestions === undefined ? {} : { suggestions: true }),
    })),
    dataOutputs: schema.dataOutputs.map((output) => ({
      id: IoId.make(output.id),
      type: output.type,
      ...(output.name === undefined ? {} : { name: output.name }),
    })),
    executionInputs: schema.executionInputs.map(executionPort),
    executionOutputs: schema.executionOutputs.map(executionPort),
  })),
};

/** Editor-only compatibility and property presentation for the built-in module. */
export const authoring: Readonly<Record<string, SchemaAuthoring.Definition>> = {
  MakeStruct: {
    runtime: registeredSchemas.get("MakeStruct")!,
    properties: {},
    acceptsOutput: (output, type, definitions) =>
      output !== "value" ||
      type._tag === "Wildcard" ||
      (type._tag === "Custom" &&
        (definitions === undefined || definitions[type.id]?._tag === "Struct")),
  },
  BreakStruct: {
    runtime: registeredSchemas.get("BreakStruct")!,
    properties: {},
    acceptsInput: (input, type, definitions) =>
      input !== "value" ||
      type._tag === "Wildcard" ||
      (type._tag === "Custom" &&
        (definitions === undefined || definitions[type.id]?._tag === "Struct")),
  },
  UpdateStruct: {
    runtime: registeredSchemas.get("UpdateStruct")!,
    properties: {},
    acceptsInput: (input, type, definitions) =>
      input !== "value" ||
      type._tag === "Wildcard" ||
      (type._tag === "Custom" &&
        (definitions === undefined || definitions[type.id]?._tag === "Struct")),
    acceptsOutput: (output, type, definitions) =>
      output !== "value" ||
      type._tag === "Wildcard" ||
      (type._tag === "Custom" &&
        (definitions === undefined || definitions[type.id]?._tag === "Struct")),
  },
  ConstructEnum: {
    runtime: registeredSchemas.get("ConstructEnum")!,
    properties: {
      variant: {
        ariaLabel: "Enum variant",
        placeholder: "Select a variant",
        unavailableLabel: "Connect the output to infer an enum first",
        options: ({ io, definitions }: SchemaAuthoring.Context) => {
          const type = io?.dataOutputs.find((output) => output.id === "value")?.type;
          const definition = type?._tag === "Custom" ? definitions[type.id] : undefined;
          return definition?._tag === "Enum"
            ? definition.variants.map((variant) => ({ id: variant.name, name: variant.name }))
            : [];
        },
      },
    },
    acceptsOutput: (output, type, definitions) =>
      output !== "value" ||
      type._tag === "Wildcard" ||
      (type._tag === "Custom" &&
        (definitions === undefined || definitions[type.id]?._tag === "Enum")),
  },
  MatchEnum: {
    runtime: registeredSchemas.get("MatchEnum")!,
    properties: {},
    acceptsInput: (input, type, definitions) =>
      input !== "value" ||
      type._tag === "Wildcard" ||
      (type._tag === "Custom" &&
        (definitions === undefined || definitions[type.id]?._tag === "Enum")),
  },
  ParseJson: {
    runtime: registeredSchemas.get("ParseJson")!,
    properties: {},
    acceptsOutput: (output, type, _definitions) =>
      output !== "value" || type._tag === "Wildcard" || type._tag === "Custom",
  },
  StringifyJson: {
    runtime: registeredSchemas.get("StringifyJson")!,
    properties: {},
    acceptsInput: (input, type, _definitions) =>
      input !== "value" || type._tag === "Wildcard" || type._tag === "Custom",
  },
};

export * as CustomTypes from "./CustomTypes.ts";
