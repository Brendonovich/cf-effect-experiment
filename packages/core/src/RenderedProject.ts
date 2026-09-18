import { DataType } from "@macrograph/module/DataType";
import { Schema } from "effect";

import { Function as GraphFunction } from "./Function.ts";
import { RenderedGraph } from "./RenderedGraph.ts";
import { Collection as ResourceConstants } from "./ResourceConstant.ts";

export const Model = Schema.Struct({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, RenderedGraph.Model),
  functions: GraphFunction.Collection,
  engines: Schema.Record(Schema.String, Schema.Json),
  constants: ResourceConstants,
  types: DataType.Definitions,
});
export type Model = typeof Model.Type;

export * as RenderedProject from "./RenderedProject.ts";
