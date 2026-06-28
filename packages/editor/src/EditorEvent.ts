import { Connection, Graph, Node } from "@macrograph/core";
import { Schema } from "effect";

export class GraphCreated extends Schema.TaggedClass<GraphCreated>()("GraphCreated", {
  graphId: Schema.String,
  graph: Graph.Model,
}) {}

export class GraphDeleted extends Schema.TaggedClass<GraphDeleted>()("GraphDeleted", {
  graphId: Schema.String,
}) {}

export class NodeCreated extends Schema.TaggedClass<NodeCreated>()("NodeCreated", {
  graphId: Schema.String,
  nodeId: Schema.String,
  node: Node.Model,
}) {}

export class NodeDeleted extends Schema.TaggedClass<NodeDeleted>()("NodeDeleted", {
  graphId: Schema.String,
  nodeId: Schema.String,
}) {}

export class NodeNameChanged extends Schema.TaggedClass<NodeNameChanged>()("NodeNameChanged", {
  graphId: Schema.String,
  nodeId: Schema.String,
  name: Schema.String,
  node: Node.Model,
}) {}

export class NodePositionChanged extends Schema.TaggedClass<NodePositionChanged>()(
  "NodePositionChanged",
  {
    graphId: Schema.String,
    nodeId: Schema.String,
    x: Schema.Number,
    y: Schema.Number,
    node: Node.Model,
  },
) {}

export class ConnectionCreated extends Schema.TaggedClass<ConnectionCreated>()(
  "ConnectionCreated",
  {
    graphId: Schema.String,
    connectionId: Schema.String,
    connection: Connection.Model,
  },
) {}

export class ConnectionDeleted extends Schema.TaggedClass<ConnectionDeleted>()(
  "ConnectionDeleted",
  {
    graphId: Schema.String,
    connectionId: Schema.String,
  },
) {}

export type EditorEvent =
  | GraphCreated
  | GraphDeleted
  | NodeCreated
  | NodeDeleted
  | NodeNameChanged
  | NodePositionChanged
  | ConnectionCreated
  | ConnectionDeleted;

export const is = <Tag extends EditorEvent["_tag"]>(
  event: EditorEvent,
  tag: Tag,
): event is Extract<EditorEvent, { _tag: Tag }> => event._tag === tag;

export * as EditorEvent from "./EditorEvent.ts";
