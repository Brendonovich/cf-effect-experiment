import { PackageId, SchemaId } from "./SchemaRef.ts";
import { Package } from "./Package.ts";

export const defaultPackage = new Package.Model({
  id: PackageId.make("core"),
  name: "Core",
  schemas: [new Package.SchemaModel({ id: SchemaId.make("log"), name: "Log" })],
});
