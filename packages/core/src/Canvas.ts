import { Effect, Schema } from "effect";

import * as Connection from "./Connection.ts";
import { Node } from "./Node.ts";
import { Collection as ScopeProjections } from "./Scopes.ts";

export const CanvasId = Schema.String.pipe(Schema.brand("CanvasId"));
export type CanvasId = typeof CanvasId.Type;

export const Model = Schema.Struct({
  id: CanvasId,
  name: Schema.String,
  nodes: Schema.Record(Schema.String, Node.Model),
  scopeProjections: Schema.optional(ScopeProjections),
  connections: Schema.Array(Connection.Model),
});
export type Model = typeof Model.Type;

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  nodes: Schema.optional(Schema.Record(Schema.String, Node.Model)),
  scopeProjections: Schema.optional(ScopeProjections),
  connections: Schema.optional(Schema.Array(Connection.Model)),
});
export type CreateInput = typeof CreateInput.Type;

export const CreateRequest = Schema.Struct({
  name: Schema.optional(Schema.String.annotate({ description: "Display name for the new graph." })),
  nodes: Schema.optional(
    Schema.Record(Schema.String, Node.CreateInput).annotate({
      description:
        "Node definitions keyed by temporary client-defined IDs. Connections in this request reference those IDs.",
    }),
  ),
  connections: Schema.optional(
    Schema.Array(Connection.CreateInput).annotate({
      description:
        "Connections between nodes in this request, using their temporary node IDs and schema port IDs.",
    }),
  ),
});
export type CreateRequest = typeof CreateRequest.Type;

export const empty = (id: string): Model => ({
  id: CanvasId.make(id),
  name: id,
  nodes: {},
  scopeProjections: {},
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
