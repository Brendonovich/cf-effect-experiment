import * as CustomTypes from "./CustomTypes.ts";
import * as GraphFunction from "./Function.ts";
import { Registry } from "./SchemaAuthoring.ts";

/** Browser-safe registrations; no engine implementations are loaded by the editor. */
export const registry = new Registry([
  { model: CustomTypes.packageModel, schemas: CustomTypes.authoring },
  { model: GraphFunction.packageModel, schemas: GraphFunction.authoring },
]);

export * as BuiltinAuthoring from "./BuiltinAuthoring.ts";
