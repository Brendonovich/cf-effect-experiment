import { Schema } from "effect";

import { Collection as Queues } from "./Queue.ts";
import { RenderedGraph } from "./RenderedGraph.ts";
import { Collection as ResourceConstants } from "./ResourceConstant.ts";

export const Model = Schema.Struct({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, RenderedGraph.Model),
  engines: Schema.Record(Schema.String, Schema.Json),
  constants: ResourceConstants,
  queues: Queues,
});
export type Model = typeof Model.Type;

export * as RenderedProject from "./RenderedProject.ts";
