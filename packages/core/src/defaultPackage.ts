import { Package } from "./Package.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const defaultPackage: Package.Model = {
  id: PackageId.make("core"),
  name: "Core",
  schemas: [{ id: SchemaId.make("log"), name: "Log" }],
};
