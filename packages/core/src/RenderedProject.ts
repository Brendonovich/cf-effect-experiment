import { t } from "@macrograph/module";
import { Schema } from "effect";

import { Function as GraphFunction } from "./Function.ts";
import { Collection as Queues } from "./Queue.ts";
import { RenderedGraph } from "./RenderedGraph.ts";
import { Collection as ResourceConstants } from "./ResourceConstant.ts";

export const Model = Schema.Struct({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, RenderedGraph.Model),
  functions: GraphFunction.Collection,
  engines: Schema.Record(Schema.String, Schema.Json),
  constants: ResourceConstants,
  queues: Queues,
  types: t.Definitions,
});
export type Model = typeof Model.Type;

export * as RenderedProject from "./RenderedProject.ts";
