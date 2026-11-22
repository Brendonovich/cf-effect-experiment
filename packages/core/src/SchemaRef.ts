import { Schema } from "effect";

export const PackageId = Schema.String.pipe(Schema.brand("PackageId"));
export type PackageId = typeof PackageId.Type;

/** PascalCase or camelCase, so it reads cleanly in URLs and saved graphs. */
export const SchemaId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9]*$/, {
    expected: "a PascalCase or camelCase node schema ID",
  }),
).pipe(Schema.brand("SchemaId"));
export type SchemaId = typeof SchemaId.Type;

export const SchemaRef = Schema.Struct({
  package: PackageId.annotate({ description: "Package ID returned by searchSchemas." }),
  schema: SchemaId.annotate({ description: "Node schema ID within the selected package." }),
});
export type SchemaRef = typeof SchemaRef.Type;
