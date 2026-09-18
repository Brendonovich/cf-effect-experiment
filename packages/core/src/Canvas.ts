import { Effect, Schema } from "effect";

import * as Connection from "./Connection.ts";
import { Node } from "./Node.ts";

export const CanvasId = Schema.String.pipe(Schema.brand("CanvasId"));
export type CanvasId = typeof CanvasId.Type;

export const Model = Schema.Struct({
  id: CanvasId,
  name: Schema.String,
  nodes: Schema.Record(Schema.String, Node.Model),
  connections: Schema.Array(Connection.Model),
});
export type Model = typeof Model.Type;

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  nodes: Schema.optional(Schema.Record(Schema.String, Node.Model)),
  connections: Schema.optional(Schema.Array(Connection.Model)),
});
export type CreateInput = typeof CreateInput.Type;

export const empty = (id: string): Model => ({
  id: CanvasId.make(id),
  name: id,
  nodes: {},
  connections: [],
});

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("CanvasNotFoundError", {
  id: Schema.String,
}) {}

export const getNode = (
  canvas: Model,
  nodeId: string,
): Effect.Effect<Node.Model, Node.NotFoundError> => {
  const node = canvas.nodes[nodeId];
  if (node) return Effect.succeed(node);
  return Effect.fail(new Node.NotFoundError({ id: nodeId }));
};

export * as Canvas from "./Canvas.ts";
