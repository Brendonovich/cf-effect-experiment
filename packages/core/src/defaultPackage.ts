import { IoId } from "./IO.ts";
import { Package } from "./Package.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const defaultPackage: Package.Model = {
  id: PackageId.make("core"),
  name: "Core",
  resources: [],
  schemas: [
    {
      id: SchemaId.make("log"),
      name: "Log",
      type: "exec",
      properties: [],
      dataInputs: [],
      dataOutputs: [],
      executionInputs: [{ id: IoId.make("exec") }],
      executionOutputs: [{ id: IoId.make("exec") }],
    },
  ],
};
