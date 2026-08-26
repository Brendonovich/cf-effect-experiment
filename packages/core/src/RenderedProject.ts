import { Schema } from "effect";

import { Collection as ResourceConstants } from "./ResourceConstant.ts";
import { RenderedGraph } from "./RenderedGraph.ts";

export const Model = Schema.Struct({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, RenderedGraph.Model),
  engines: Schema.Record(Schema.String, Schema.Json),
  constants: ResourceConstants,
});
export type Model = typeof Model.Type;

export * as RenderedProject from "./RenderedProject.ts";
