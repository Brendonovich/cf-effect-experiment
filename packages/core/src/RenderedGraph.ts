import { Schema } from "effect";

import * as Connection from "./Connection.ts";
import { FunctionSignature, GraphId } from "./Graph.ts";
import { NodeIO } from "./IO.ts";
import { NodeId } from "./Node.ts";
import { Package } from "./Package.ts";
import { Position } from "./Position.ts";
import { SchemaRef } from "./SchemaRef.ts";

export const Node = Schema.Struct({
  id: NodeId,
  name: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Json),
  inputDefaults: Schema.Record(Schema.String, Schema.Json),
  foldPins: Schema.Boolean,
  schema: SchemaRef,
  position: Position,
  io: NodeIO,
});
export type Node = typeof Node.Type;

export const Model = Schema.Struct({
  id: GraphId,
  name: Schema.String,
  kind: Schema.optional(Schema.Literals(["ordinary", "function"])),
  signature: Schema.optional(FunctionSignature),
  nodes: Schema.Record(Schema.String, Node),
  connections: Schema.Array(Connection.Model),
  schemas: Schema.Record(Schema.String, Schema.Record(Schema.String, Package.SchemaModel)),
});
export type Model = typeof Model.Type;

export * as RenderedGraph from "./RenderedGraph.ts";
