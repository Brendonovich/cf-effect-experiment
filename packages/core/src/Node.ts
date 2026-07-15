import { Schema } from "effect";

import { Position } from "./Position.ts";
import { SchemaRef } from "./SchemaRef.ts";

export const NodeId = Schema.String.pipe(Schema.brand("NodeId"));
export type NodeId = typeof NodeId.Type;

export const Model = Schema.Struct({
  id: NodeId,
  name: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
  schema: SchemaRef,
  position: Position,
});
export type Model = typeof Model.Type;

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  schema: SchemaRef,
  position: Schema.optional(Position),
});
export type CreateInput = typeof CreateInput.Type;

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("NodeNotFoundError", {
  id: Schema.String,
}) {}

export * as Node from "./Node.ts";
