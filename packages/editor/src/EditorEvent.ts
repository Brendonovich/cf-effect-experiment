import {
  Actor,
  Canvas,
  Connection,
  Function as GraphFunction,
  IoId,
  Node,
  NodeIO,
  ResourceConstant,
  Queue,
  Scopes,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { Effect, Schema } from "effect";

const actor = Actor.Model.pipe(Schema.withDecodingDefaultKey(Effect.succeed(Actor.system)));
const emptyNodeIO: NodeIO = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [],
  executionOutputs: [],
};

export const TypeDefinitionsUpdated = Schema.TaggedStruct("TypeDefinitionsUpdated", {
  actor,
  types: DataType.Definitions,
  nodeIO: Schema.Record(Schema.String, Schema.Record(Schema.String, NodeIO)),
  deletedConnectionIds: Schema.Record(Schema.String, Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
});
export type TypeDefinitionsUpdated = typeof TypeDefinitionsUpdated.Type;

export const GraphCreated = Schema.TaggedStruct("GraphCreated", {
  actor,
  graph: Canvas.Model,
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

export const FunctionCreated = Schema.TaggedStruct("FunctionCreated", {
  actor,
  graph: Canvas.Model,
  fn: GraphFunction.Model,
});
export type FunctionCreated = typeof FunctionCreated.Type;

export const FunctionUpdated = Schema.TaggedStruct("FunctionUpdated", {
  actor,
  fn: GraphFunction.Model,
  deletedConnectionIds: Schema.Array(Schema.String),
});
export type FunctionUpdated = typeof FunctionUpdated.Type;

export const NodeCreated = Schema.TaggedStruct("NodeCreated", {
  actor,
  graphId: Schema.String,
  node: Node.Model,
  io: NodeIO.pipe(Schema.withDecodingDefaultKey(Effect.succeed(emptyNodeIO))),
});
export type NodeCreated = typeof NodeCreated.Type;

export const ScopeProjectionCreated = Schema.TaggedStruct("ScopeProjectionCreated", {
  actor,
  graphId: Schema.String,
  projection: Scopes.Projection,
  node: Node.Model,
  connection: Connection.Model,
  io: NodeIO,
});
export type ScopeProjectionCreated = typeof ScopeProjectionCreated.Type;

export const FragmentPasted = Schema.TaggedStruct("FragmentPasted", {
  actor,
  graphId: Schema.String,
  nodes: Schema.Array(Node.Model),
  connections: Schema.Array(Connection.Model),
  scopeProjections: Schema.Array(Scopes.Projection).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  nodeIO: Schema.Record(Schema.String, NodeIO),
});
export type FragmentPasted = typeof FragmentPasted.Type;

export const FragmentDeleted = Schema.TaggedStruct("FragmentDeleted", {
  actor,
  graphId: Schema.String,
  nodeIds: Schema.Array(Schema.String),
  deletedConnectionIds: Schema.Array(Schema.String),
});
export type FragmentDeleted = typeof FragmentDeleted.Type;

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

export const NodeScopeSplitChanged = Schema.TaggedStruct("NodeScopeSplitChanged", {
  actor,
  graphId: Schema.String,
  nodeId: Schema.String,
  splitScopeOutputs: Schema.Array(IoId),
});
export type NodeScopeSplitChanged = typeof NodeScopeSplitChanged.Type;

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
  moduleId: Schema.String,
  state: Schema.Json,
});
export type EngineStateChanged = typeof EngineStateChanged.Type;

export const ModuleClientStateDirty = Schema.TaggedStruct("ModuleClientStateDirty", {
  actor,
  moduleId: Schema.String,
});
export type ModuleClientStateDirty = typeof ModuleClientStateDirty.Type;

export const ResourceConstantCreated = Schema.TaggedStruct("ResourceConstantCreated", {
  actor,
  constant: ResourceConstant.Model,
});
export type ResourceConstantCreated = typeof ResourceConstantCreated.Type;

export const ResourceConstantDefaultChanged = Schema.TaggedStruct(
  "ResourceConstantDefaultChanged",
  {
    actor,
    constants: Schema.Array(ResourceConstant.Model),
  },
);
export type ResourceConstantDefaultChanged = typeof ResourceConstantDefaultChanged.Type;

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

export const QueueUpdated = Schema.TaggedStruct("QueueUpdated", { actor, queue: Queue.Model });
export type QueueUpdated = typeof QueueUpdated.Type;
export const QueueDeleted = Schema.TaggedStruct("QueueDeleted", { actor, queueId: Schema.String });
export type QueueDeleted = typeof QueueDeleted.Type;

export type Persistent =
  | QueueUpdated
  | QueueDeleted
  | TypeDefinitionsUpdated
  | FragmentPasted
  | FragmentDeleted
  | GraphCreated
  | GraphDeleted
  | GraphNameChanged
  | FunctionCreated
  | FunctionUpdated
  | NodeCreated
  | ScopeProjectionCreated
  | NodeDeleted
  | NodeNameChanged
  | NodePositionChanged
  | NodeFoldPinsChanged
  | NodeScopeSplitChanged
  | NodePropertyUpdated
  | InputDefaultUpdated
  | ConnectionCreated
  | ConnectionDeleted
  | EngineStateChanged
  | ResourceConstantCreated
  | ResourceConstantDefaultChanged
  | ResourceConstantUpdated
  | ResourceConstantDeleted;

export type Ephemeral = ModuleClientStateDirty | ResourceValuesUpdated;
export type EditorEvent = Persistent | Ephemeral;

export const ephemeralTags = ["ModuleClientStateDirty", "ResourceValuesUpdated"] as const;

const ephemeralTagSet: ReadonlySet<EditorEvent["_tag"]> = new Set(ephemeralTags);

/** Events that update live editor state but do not change Project.Model. */
export const isEphemeral = (event: EditorEvent): event is Ephemeral =>
  ephemeralTagSet.has(event._tag);

export const isPersistent = (event: EditorEvent): event is Persistent => !isEphemeral(event);

export const is = <Tag extends EditorEvent["_tag"]>(
  event: EditorEvent,
  tag: Tag,
): event is Extract<EditorEvent, { _tag: Tag }> => event._tag === tag;

export * as EditorEvent from "./EditorEvent.ts";
