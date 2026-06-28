import { Schema } from "effect";

import { PackageId, SchemaId, SchemaRef } from "./SchemaRef.ts";

export class SchemaModel extends Schema.Class<SchemaModel>("PackageSchema")({
  id: SchemaId,
  name: Schema.String,
}) {}

export class Model extends Schema.Class<Model>("Package")({
  id: PackageId,
  name: Schema.String,
  schemas: Schema.Array(SchemaModel),
}) {}

export class SchemaNotFoundError extends Schema.TaggedErrorClass<SchemaNotFoundError>()(
  "SchemaNotFoundError",
  {
    ref: SchemaRef,
  },
) {}

export * as Package from "./Package.ts";
