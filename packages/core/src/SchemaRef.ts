import { Schema } from "effect";

export const PackageId = Schema.String.pipe(Schema.brand("PackageId"));
export type PackageId = typeof PackageId.Type;

export const SchemaId = Schema.String.pipe(Schema.brand("SchemaId"));
export type SchemaId = typeof SchemaId.Type;

export const SchemaRef = Schema.Struct({
  package: PackageId.annotate({ description: "Package ID returned by searchSchemas." }),
  schema: SchemaId.annotate({ description: "Node schema ID within the selected package." }),
});
export type SchemaRef = typeof SchemaRef.Type;
