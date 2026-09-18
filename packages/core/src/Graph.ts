import { Effect, Schema } from "effect";

import type { Model as NodeModel } from "./Node.ts";
import type { SchemaModel } from "./Package.ts";

import { Canvas } from "./Canvas.ts";

/** @deprecated Use CanvasId. */
export const GraphId = Canvas.CanvasId;
/** @deprecated Use CanvasId. */
export type GraphId = Canvas.CanvasId;

export const Model = Schema.Struct({
  canvas: Canvas.Model,
});
export type Model = typeof Model.Type;

export const CreateInput = Canvas.CreateInput;
export type CreateInput = typeof CreateInput.Type;

export const empty = (id: string): Model => ({
  canvas: Canvas.empty(id),
});

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("GraphNotFoundError", {
  id: Schema.String,
}) {}

export const validateNode = (
  _graph: Model,
  _node: NodeModel,
  _schema: SchemaModel,
): Effect.Effect<void> => Effect.void;

export * as Graph from "./Graph.ts";
