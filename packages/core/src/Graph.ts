import { Effect, Schema } from "effect";

import * as Connection from "./Connection.ts";
import { Node } from "./Node.ts";

export const GraphId = Schema.String.pipe(Schema.brand("GraphId"));
export type GraphId = typeof GraphId.Type;

export class Model extends Schema.Class<Model>("Graph")({
  id: GraphId,
  name: Schema.String,
  nodes: Schema.Record(Schema.String, Node.Model),
  connections: Schema.Array(Connection.Model),
}) {}

export class CreateInput extends Schema.Class<CreateInput>("GraphCreateInput")({
  name: Schema.optional(Schema.String),
  nodes: Schema.optional(Schema.Record(Schema.String, Node.Model)),
  connections: Schema.optional(Schema.Array(Connection.Model)),
}) {}

export const empty = (id: string) =>
  new Model({
    id: GraphId.make(id),
    name: id,
    nodes: {},
    connections: [],
  });

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("GraphNotFoundError", {
  id: Schema.String,
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
