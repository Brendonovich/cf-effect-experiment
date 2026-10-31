import type * as Registration from "@macrograph/module/Registration";

import { Conversion, t } from "@macrograph/module";
import { Effect, Schema } from "effect";

import { DataPort, ExecutionPort, IoId, type NodeIO } from "./IO.ts";
import { PackageId, SchemaId, SchemaRef } from "./SchemaRef.ts";
import { executionPort } from "./Scopes.ts";

export const ResourceDefinition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
});
export type ResourceDefinition = typeof ResourceDefinition.Type;

const ScalarPropertyDefinition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  type: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("String") }),
    Schema.Struct({ _tag: Schema.Literal("Int") }),
    Schema.Struct({ _tag: Schema.Literal("Float") }),
    Schema.Struct({ _tag: Schema.Literal("Bool") }),
  ]),
  optional: Schema.Boolean,
  defaultValue: Schema.optional(Schema.Json),
});
const ResourcePropertyDefinition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  resource: Schema.String,
  optional: Schema.Literal(false),
});
const FunctionPropertyDefinition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  function: Schema.Literal(true),
  optional: Schema.Boolean,
});
export const PropertyDefinition = Schema.Union([
  ScalarPropertyDefinition,
  ResourcePropertyDefinition,
  FunctionPropertyDefinition,
]);
export type PropertyDefinition = typeof PropertyDefinition.Type;

export const SchemaModel = Schema.Struct({
  id: SchemaId,
  internal: Schema.optional(Schema.Boolean),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  type: Schema.Literals(["base", "event", "exec", "pure"]),
  properties: Schema.Array(PropertyDefinition).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  dataInputs: Schema.Array(DataPort).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  dataOutputs: Schema.Array(DataPort).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  executionInputs: Schema.Array(ExecutionPort),
  executionOutputs: Schema.Array(ExecutionPort),
});
export type SchemaModel = typeof SchemaModel.Type;

export const Model = Schema.Struct({
  id: PackageId,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  schemas: Schema.Array(SchemaModel),
  resources: Schema.Array(ResourceDefinition).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  types: Schema.optional(t.Definitions),
  /** Conversions this package registers; implementations stay with the executor. */
  conversions: Schema.optional(Schema.Array(Conversion.Pair)),
});
export type Model = typeof Model.Type;

/** The parts of a module definition that describe its package. */
export interface ModuleInfo {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export interface ResourceInfo {
  readonly key: string;
  readonly definition: { readonly name: string; readonly description?: string };
}

/**
 * Converts IO a schema generated into its serializable form. Defaults that fail to encode are
 * dropped, so an invalid module default never stops a node from rendering.
 */
export const nodeIO = (io: Registration.RegisteredNodeIO, definitions: t.Definitions): NodeIO => ({
  dataInputs: io.dataInputs.map((input) => {
    const encoded =
      input.defaultValue === undefined
        ? undefined
        : Schema.encodeUnknownResult(t.JsonDefaultSchema(input.type, definitions))(
            input.defaultValue,
          );
    return {
      id: IoId.make(input.id),
      type: input.type,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(encoded === undefined || encoded._tag === "Failure"
        ? {}
        : { defaultValue: encoded.success }),
      ...(input.suggestions === undefined ? {} : { suggestions: true }),
    };
  }),
  dataOutputs: io.dataOutputs.map((output) => ({
    id: IoId.make(output.id),
    type: output.type,
    ...(output.name === undefined ? {} : { name: output.name }),
  })),
  executionInputs: io.executionInputs.map(executionPort),
  executionOutputs: io.executionOutputs.map(executionPort),
});

/**
 * Describes a module's registered schemas and engine resources as a package. Default values are
 * encoded against `definitions`, which must include the module's own types and any project types
 * they reference.
 */
export const fromModule = (
  module: ModuleInfo,
  resources: ReadonlyArray<ResourceInfo>,
  collected: Registration.Collected,
  definitions: t.Definitions,
): Model => {
  const encodeValue = (type: t.Type, value: unknown): Schema.Json =>
    Schema.decodeUnknownSync(Schema.Json)(
      Schema.encodeUnknownSync(t.JsonDefaultSchema(type, definitions))(value),
    );
  const conversions = collected.conversions.map(({ from, to }) => ({ from, to }));
  return {
    id: PackageId.make(module.id),
    name: module.name ?? module.id,
    types: collected.types,
    ...(conversions.length === 0 ? {} : { conversions }),
    ...(module.description === undefined ? {} : { description: module.description }),
    resources: resources.map((resource) => ({
      id: resource.key,
      name: resource.definition.name,
      ...(resource.definition.description === undefined
        ? {}
        : { description: resource.definition.description }),
    })),
    schemas: collected.schemas.map((schema) => ({
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
                : { defaultValue: encodeValue(property.type, property.defaultValue) }),
            },
      ),
      ...nodeIO(schema, definitions),
    })),
  };
};

export class SchemaNotFoundError extends Schema.TaggedError<SchemaNotFoundError>()(
  "SchemaNotFoundError",
  {
    ref: SchemaRef,
  },
) {}

export class InvalidPropertyError extends Schema.TaggedError<InvalidPropertyError>()(
  "InvalidPropertyError",
  { property: Schema.String, reason: Schema.String },
) {}

export class InvalidInputDefaultError extends Schema.TaggedError<InvalidInputDefaultError>()(
  "InvalidInputDefaultError",
  { input: Schema.String, reason: Schema.String },
) {}

export * as Package from "./Package.ts";
