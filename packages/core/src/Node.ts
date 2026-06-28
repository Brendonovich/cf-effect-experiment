import { Schema } from "effect";

import { Position } from "./Position.ts";
import { SchemaRef } from "./SchemaRef.ts";

export const NodeId = Schema.String.pipe(Schema.brand("NodeId"));
export type NodeId = typeof NodeId.Type;

export class Model extends Schema.Class<Model>("Node")({
  id: NodeId,
  name: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
  schema: SchemaRef,
  position: Position,
}) {}

export class CreateInput extends Schema.Class<CreateInput>("NodeCreateInput")({
  name: Schema.optional(Schema.String),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  schema: SchemaRef,
  position: Schema.optional(Position),
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("NodeNotFoundError", {
  id: Schema.String,
}) {}

export * as Node from "./Node.ts";
