import { DataType } from "@macrograph/plugin/DataType";
import { Schema } from "effect";

import { RenderedGraph } from "./RenderedGraph.ts";
import { Collection as ResourceConstants } from "./ResourceConstant.ts";

export const Model = Schema.Struct({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, RenderedGraph.Model),
  engines: Schema.Record(Schema.String, Schema.Json),
  constants: ResourceConstants,
  types: DataType.Definitions,
});
export type Model = typeof Model.Type;

export * as RenderedProject from "./RenderedProject.ts";
