import { Effect, Schema } from "effect";

import { DataPort, ExecutionPort } from "./IO.ts";
import { PackageId, SchemaId, SchemaRef } from "./SchemaRef.ts";

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
export const PropertyDefinition = Schema.Union([
  ScalarPropertyDefinition,
  ResourcePropertyDefinition,
]);
export type PropertyDefinition = typeof PropertyDefinition.Type;

export const SchemaModel = Schema.Struct({
  id: SchemaId,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  type: Schema.Literals(["event", "exec", "pure"]),
  internal: Schema.optional(Schema.Boolean),
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
  schemas: Schema.Array(SchemaModel),
  resources: Schema.Array(ResourceDefinition).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});
export type Model = typeof Model.Type;

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
