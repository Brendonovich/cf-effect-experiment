import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Schema } from "effect";

import * as Connection from "./Connection.ts";
import { Node } from "./Node.ts";

export const FunctionField = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: DataType.Descriptor,
});
export type FunctionField = typeof FunctionField.Type;
export const FunctionSignature = Schema.Struct({
  inputs: Schema.Array(FunctionField),
  outputs: Schema.Array(FunctionField),
});
export type FunctionSignature = typeof FunctionSignature.Type;

export const GraphId = Schema.String.pipe(Schema.brand("GraphId"));
export type GraphId = typeof GraphId.Type;

export const Model = Schema.Struct({
  id: GraphId,
  name: Schema.String,
  kind: Schema.optional(Schema.Literals(["ordinary", "function"])),
  signature: Schema.optional(FunctionSignature),
  nodes: Schema.Record(Schema.String, Node.Model),
  connections: Schema.Array(Connection.Model),
});
export type Model = typeof Model.Type;

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(["ordinary", "function"])),
  signature: Schema.optional(FunctionSignature),
  nodes: Schema.optional(Schema.Record(Schema.String, Node.Model)),
  connections: Schema.optional(Schema.Array(Connection.Model)),
});
export type CreateInput = typeof CreateInput.Type;

export const empty = (id: string): Model => ({
  id: GraphId.make(id),
  name: id,
  nodes: {},
  connections: [],
});

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("GraphNotFoundError", {
  id: Schema.String,
}) {}

export class FunctionError extends Schema.TaggedError<FunctionError>()("FunctionError", {
  graphId: Schema.String,
  reason: Schema.String,
}) {}
export class FunctionImpact extends Schema.TaggedError<FunctionImpact>()("FunctionImpact", {
  graphId: Schema.String,
  reason: Schema.String,
  callerNodeIds: Schema.Array(Schema.String),
}) {}

export const getNode = (
  graph: Model,
  nodeId: string,
): Effect.Effect<Node.Model, Node.NotFoundError> => {
  const node = graph.nodes[nodeId];
  if (node) return Effect.succeed(node);
  return Effect.fail(new Node.NotFoundError({ id: nodeId }));
};

export * as Graph from "./Graph.ts";
