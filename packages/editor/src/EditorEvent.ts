import { Connection, Graph, Node } from "@macrograph/core";
import { Schema } from "effect";

export const GraphCreated = Schema.TaggedStruct("GraphCreated", {
  graph: Graph.Model,
});
export type GraphCreated = typeof GraphCreated.Type;

export const GraphDeleted = Schema.TaggedStruct("GraphDeleted", {
  graphId: Schema.String,
});
export type GraphDeleted = typeof GraphDeleted.Type;

export const NodeCreated = Schema.TaggedStruct("NodeCreated", {
  graphId: Schema.String,
  node: Node.Model,
});
export type NodeCreated = typeof NodeCreated.Type;

export const NodeDeleted = Schema.TaggedStruct("NodeDeleted", {
  graphId: Schema.String,
  nodeId: Schema.String,
});
export type NodeDeleted = typeof NodeDeleted.Type;

export const NodeNameChanged = Schema.TaggedStruct("NodeNameChanged", {
  graphId: Schema.String,
  nodeId: Schema.String,
  name: Schema.String,
});
export type NodeNameChanged = typeof NodeNameChanged.Type;

export const NodePositionChanged = Schema.TaggedStruct("NodePositionChanged", {
  graphId: Schema.String,
  nodeId: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  clientId: Schema.optional(Schema.String),
});
export type NodePositionChanged = typeof NodePositionChanged.Type;

export const ConnectionCreated = Schema.TaggedStruct("ConnectionCreated", {
  graphId: Schema.String,
  connection: Connection.Model,
});
export type ConnectionCreated = typeof ConnectionCreated.Type;

export const ConnectionDeleted = Schema.TaggedStruct("ConnectionDeleted", {
  graphId: Schema.String,
  connectionId: Schema.String,
});
export type ConnectionDeleted = typeof ConnectionDeleted.Type;

export const EngineStateChanged = Schema.TaggedStruct("EngineStateChanged", {
  pluginId: Schema.String,
  state: Schema.Unknown,
});
export type EngineStateChanged = typeof EngineStateChanged.Type;

export type EditorEvent =
  | GraphCreated
  | GraphDeleted
  | NodeCreated
  | NodeDeleted
  | NodeNameChanged
  | NodePositionChanged
  | ConnectionCreated
  | ConnectionDeleted
  | EngineStateChanged;

export const is = <Tag extends EditorEvent["_tag"]>(
  event: EditorEvent,
  tag: Tag,
): event is Extract<EditorEvent, { _tag: Tag }> => event._tag === tag;

export * as EditorEvent from "./EditorEvent.ts";
