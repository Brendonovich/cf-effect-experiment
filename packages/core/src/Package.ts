import { Schema } from "effect";

import { ExecutionPort } from "./IO.ts";
import { PackageId, SchemaId, SchemaRef } from "./SchemaRef.ts";

export const SchemaModel = Schema.Struct({
  id: SchemaId,
  name: Schema.String,
  type: Schema.Literals(["event", "exec", "pure"]),
  executionInputs: Schema.Array(ExecutionPort),
  executionOutputs: Schema.Array(ExecutionPort),
});
export type SchemaModel = typeof SchemaModel.Type;

export const Model = Schema.Struct({
  id: PackageId,
  name: Schema.String,
  schemas: Schema.Array(SchemaModel),
});
export type Model = typeof Model.Type;

export class SchemaNotFoundError extends Schema.TaggedErrorClass<SchemaNotFoundError>()(
  "SchemaNotFoundError",
  {
    ref: SchemaRef,
  },
) {}

export * as Package from "./Package.ts";
