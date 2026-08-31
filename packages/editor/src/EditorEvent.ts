import {
  Actor,
  Connection,
  CustomEvent,
  Graph,
  Node,
  NodeIO,
  Package,
  ResourceConstant,
} from "@macrograph/core";
import { Effect, Schema } from "effect";

const actor = Actor.Model.pipe(Schema.withDecodingDefaultKey(Effect.succeed(Actor.system)));
const emptyNodeIO: NodeIO = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [],
  executionOutputs: [],
};

export const GraphCreated = Schema.TaggedStruct("GraphCreated", {
  actor,
  graph: Graph.Model,
});
export type GraphCreated = typeof GraphCreated.Type;

export const GraphDeleted = Schema.TaggedStruct("GraphDeleted", {
  actor,
  graphId: Schema.String,
});
export type GraphDeleted = typeof GraphDeleted.Type;

export const GraphNameChanged = Schema.TaggedStruct("GraphNameChanged", {
  actor,
  graphId: Schema.String,
  name: Schema.String,
});
export type GraphNameChanged = typeof GraphNameChanged.Type;

export const NodeCreated = Schema.TaggedStruct("NodeCreated", {
  actor,
  graphId: Schema.String,
  node: Node.Model,
  io: NodeIO.pipe(Schema.withDecodingDefaultKey(Effect.succeed(emptyNodeIO))),
});
export type NodeCreated = typeof NodeCreated.Type;

export const NodeDeleted = Schema.TaggedStruct("NodeDeleted", {
  actor,
  graphId: Schema.String,
  nodeId: Schema.String,
  deletedConnectionIds: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});
export type NodeDeleted = typeof NodeDeleted.Type;

export const NodeNameChanged = Schema.TaggedStruct("NodeNameChanged", {
  actor,
  graphId: Schema.String,
  nodeId: Schema.String,
  name: Schema.String,
});
export type NodeNameChanged = typeof NodeNameChanged.Type;

export const NodePositionChanged = Schema.TaggedStruct("NodePositionChanged", {
  actor,
  graphId: Schema.String,
  nodeId: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
});
export type NodePositionChanged = typeof NodePositionChanged.Type;

export const NodeFoldPinsChanged = Schema.TaggedStruct("NodeFoldPinsChanged", {
  actor,
  graphId: Schema.String,
  nodeId: Schema.String,
  foldPins: Schema.Boolean,
});
export type NodeFoldPinsChanged = typeof NodeFoldPinsChanged.Type;

export const NodePropertyUpdated = Schema.TaggedStruct("NodePropertyUpdated", {
  actor,
  graphId: Schema.String,
  nodeId: Schema.String,
  property: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Json),
  inputDefaults: Schema.Record(Schema.String, Schema.Json),
  deletedConnectionIds: Schema.Array(Schema.String),
  io: NodeIO,
});
export type NodePropertyUpdated = typeof NodePropertyUpdated.Type;

export const InputDefaultUpdated = Schema.TaggedStruct("InputDefaultUpdated", {
  actor,
  graphId: Schema.String,
  nodeId: Schema.String,
  input: Schema.String,
  inputDefaults: Schema.Record(Schema.String, Schema.Json),
});
export type InputDefaultUpdated = typeof InputDefaultUpdated.Type;

export const ConnectionCreated = Schema.TaggedStruct("ConnectionCreated", {
  actor,
  graphId: Schema.String,
  connection: Connection.Model,
});
export type ConnectionCreated = typeof ConnectionCreated.Type;

export const ConnectionDeleted = Schema.TaggedStruct("ConnectionDeleted", {
  actor,
  graphId: Schema.String,
  connectionId: Schema.String,
});
export type ConnectionDeleted = typeof ConnectionDeleted.Type;

export const EngineStateChanged = Schema.TaggedStruct("EngineStateChanged", {
  actor,
  pluginId: Schema.String,
  state: Schema.Json,
});
export type EngineStateChanged = typeof EngineStateChanged.Type;

export const PluginClientStateDirty = Schema.TaggedStruct("PluginClientStateDirty", {
  actor,
  pluginId: Schema.String,
});
export type PluginClientStateDirty = typeof PluginClientStateDirty.Type;

export const ResourceConstantCreated = Schema.TaggedStruct("ResourceConstantCreated", {
  actor,
  constant: ResourceConstant.Model,
});
export type ResourceConstantCreated = typeof ResourceConstantCreated.Type;

export const ResourceConstantUpdated = Schema.TaggedStruct("ResourceConstantUpdated", {
  actor,
  constant: ResourceConstant.Model,
  nodeIO: Schema.Record(Schema.String, Schema.Record(Schema.String, NodeIO)),
  inputDefaults: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Json)),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  deletedConnectionIds: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export type ResourceConstantUpdated = typeof ResourceConstantUpdated.Type;

export const ResourceConstantDeleted = Schema.TaggedStruct("ResourceConstantDeleted", {
  actor,
  constantId: Schema.String,
});
export type ResourceConstantDeleted = typeof ResourceConstantDeleted.Type;

export const ResourceValuesUpdated = Schema.TaggedStruct("ResourceValuesUpdated", {
  actor,
  package: Schema.String,
  resource: Schema.String,
  values: Schema.Array(ResourceConstant.LiveValue),
});
export type ResourceValuesUpdated = typeof ResourceValuesUpdated.Type;

export const CustomEventsChanged = Schema.TaggedStruct("CustomEventsChanged", {
  actor,
  customEvents: CustomEvent.Collection,
  graphs: Schema.Record(Schema.String, Graph.Model),
  nodeIO: Schema.Record(Schema.String, Schema.Record(Schema.String, NodeIO)),
  pkg: Package.Model,
});
export type CustomEventsChanged = typeof CustomEventsChanged.Type;

export type EditorEvent =
  | CustomEventsChanged
  | GraphCreated
  | GraphDeleted
  | GraphNameChanged
  | NodeCreated
  | NodeDeleted
  | NodeNameChanged
  | NodePositionChanged
  | NodeFoldPinsChanged
  | NodePropertyUpdated
  | InputDefaultUpdated
  | ConnectionCreated
  | ConnectionDeleted
  | EngineStateChanged
  | PluginClientStateDirty
  | ResourceConstantCreated
  | ResourceConstantUpdated
  | ResourceConstantDeleted
  | ResourceValuesUpdated;

export const is = <Tag extends EditorEvent["_tag"]>(
  event: EditorEvent,
  tag: Tag,
): event is Extract<EditorEvent, { _tag: Tag }> => event._tag === tag;

export * as EditorEvent from "./EditorEvent.ts";
