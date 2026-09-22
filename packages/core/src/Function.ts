import { DataType } from "@macrograph/module/DataType";
import { Effect, Schema } from "effect";

import type { SchemaModel } from "./Package.ts";
import type { Package } from "./Package.ts";
import type * as SchemaAuthoring from "./SchemaAuthoring.ts";

import { Canvas } from "./Canvas.ts";
import { IoId, type NodeIO } from "./IO.ts";
import { NodeId, type Model as NodeModel } from "./Node.ts";
import { Position } from "./Position.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const InputBoundaryNodeId = NodeId.make("$function:input");
export const OutputBoundaryNodeId = NodeId.make("$function:output");
export const ExecutionIoId = IoId.make("exec");
export const packageId = PackageId.make("macrograph-functions");
export const queuePackageId = PackageId.make("macrograph-queues");
export const CallSchemaId = SchemaId.make("call");
export const QueuedCallSchemaId = SchemaId.make("add");

export const isQueuedCall = (node: Pick<NodeModel, "schema">): boolean =>
  node.schema.package === queuePackageId && node.schema.schema === QueuedCallSchemaId;

export const isCall = (node: Pick<NodeModel, "schema">): boolean =>
  (node.schema.package === packageId && node.schema.schema === CallSchemaId) || isQueuedCall(node);

export const Field = Schema.Struct({
  id: IoId,
  name: Schema.String,
  type: DataType.Descriptor,
});
export type Field = typeof Field.Type;

export const Model = Schema.Struct({
  canvas: Canvas.Model,
  arguments: Schema.Array(Field),
  returns: Schema.Array(Field),
  inputPosition: Position,
  outputPosition: Position,
});
export type Model = typeof Model.Type;

export const Collection = Schema.Record(Schema.String, Model).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);
export type Collection = typeof Collection.Type;

export const isBoundaryNodeId = (nodeId: string): boolean =>
  nodeId === InputBoundaryNodeId || nodeId === OutputBoundaryNodeId;

export const boundaryIO = (fn: Model, nodeId: string): NodeIO | undefined => {
  if (nodeId === InputBoundaryNodeId)
    return {
      executionInputs: [],
      executionOutputs: [{ id: ExecutionIoId }],
      dataInputs: [],
      dataOutputs: fn.arguments,
    };
  if (nodeId === OutputBoundaryNodeId)
    return {
      executionInputs: [{ id: ExecutionIoId }],
      executionOutputs: [],
      dataInputs: fn.returns,
      dataOutputs: [],
    };
  return undefined;
};

export const callIO = (fn: Model | undefined): NodeIO => ({
  executionInputs: [{ id: ExecutionIoId }],
  executionOutputs: [{ id: ExecutionIoId }],
  dataInputs: fn?.arguments ?? [],
  dataOutputs: fn?.returns ?? [],
});

export const packageModel: Package.Model = {
  id: packageId,
  name: "Functions",
  resources: [],
  schemas: [
    {
      id: CallSchemaId,
      name: "Execute Function",
      type: "exec",
      properties: [{ id: "function", name: "Function", function: true, optional: true }],
      ...callIO(undefined),
    },
  ],
};

export const queuePackageModel: Package.Model = {
  id: queuePackageId,
  name: "Queues",
  resources: [],
  schemas: [
    {
      id: QueuedCallSchemaId,
      name: "Add to Queue",
      type: "exec",
      properties: [
        { id: "queue", name: "Queue", type: { _tag: "String" }, optional: true },
        { id: "function", name: "Function", function: true, optional: true },
      ],
      ...callIO(undefined),
    },
  ],
};

export const authoring: Readonly<Record<string, SchemaAuthoring.Definition>> = {};

const boundarySchema = {
  package: PackageId.make("$macrograph"),
  schema: SchemaId.make("function-boundary"),
};

export const boundaryNodes = (fn: Model): ReadonlyArray<NodeModel> => [
  {
    id: InputBoundaryNodeId,
    name: "Function Input",
    properties: {},
    inputDefaults: {},
    foldPins: false,
    schema: boundarySchema,
    position: fn.inputPosition,
  },
  {
    id: OutputBoundaryNodeId,
    name: "Function Output",
    properties: {},
    inputDefaults: {},
    foldPins: false,
    schema: boundarySchema,
    position: fn.outputPosition,
  },
];

export const projectCanvas = (fn: Model): Canvas.Model => ({
  ...fn.canvas,
  nodes: {
    ...fn.canvas.nodes,
    ...Object.fromEntries(boundaryNodes(fn).map((node) => [node.id, node])),
  },
});

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("FunctionNotFoundError", {
  canvasId: Schema.String,
}) {}

export class EventNodeNotAllowedError extends Schema.TaggedError<EventNodeNotAllowedError>()(
  "FunctionEventNodeNotAllowedError",
  { nodeId: Schema.String },
) {}

export class InvocationError extends Schema.TaggedError<InvocationError>()(
  "FunctionInvocationError",
  { canvasId: Schema.String, reason: Schema.String },
) {}

export const validateNode = (
  _fn: Model,
  node: NodeModel,
  schema: SchemaModel,
): Effect.Effect<void, EventNodeNotAllowedError> =>
  schema.type === "event"
    ? Effect.fail(new EventNodeNotAllowedError({ nodeId: node.id }))
    : Effect.void;

export * as Function from "./Function.ts";
