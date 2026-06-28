import { Schema } from "effect";

export const PackageId = Schema.String.pipe(Schema.brand("PackageId"));
export type PackageId = typeof PackageId.Type;

export const SchemaId = Schema.String.pipe(Schema.brand("SchemaId"));
export type SchemaId = typeof SchemaId.Type;

export class SchemaRef extends Schema.Class<SchemaRef>("SchemaRef")({
  package: PackageId,
  schema: SchemaId,
}) {}
