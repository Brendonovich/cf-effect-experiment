import { DataType } from "@macrograph/module/DataType";
import { Effect, Schema } from "effect";

import type { Model as NodeModel } from "./Node.ts";
import type { SchemaModel } from "./Package.ts";

import { Canvas } from "./Canvas.ts";
import { IoId, type NodeIO } from "./IO.ts";
import { NodeId } from "./Node.ts";
import { type Model as PackageModel } from "./Package.ts";
import { Position } from "./Position.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const QueueId = Schema.String.pipe(Schema.brand("QueueId"));
export type QueueId = typeof QueueId.Type;
export const InputBoundaryNodeId = NodeId.make("$queue:input");
export const OutputBoundaryNodeId = NodeId.make("$queue:output");
export const ExecutionIoId = IoId.make("exec");
export const packageId = PackageId.make("macrograph-queues");
export const EnqueueSchemaId = SchemaId.make("add");
export const Field = Schema.Struct({ id: IoId, name: Schema.String, type: DataType.Descriptor });
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
export const Item = Schema.Struct({ id: Schema.String });
export const State = Schema.Struct({
  queueId: Schema.String,
  paused: Schema.Boolean,
  waiting: Schema.Array(Item),
  running: Schema.Array(Item),
});
export type State = typeof State.Type;

export const isEnqueue = (node: Pick<NodeModel, "schema">): boolean =>
  node.schema.package === packageId && node.schema.schema === EnqueueSchemaId;
export const isBoundaryNodeId = (nodeId: string): boolean =>
  nodeId === InputBoundaryNodeId || nodeId === OutputBoundaryNodeId;
export const boundaryIO = (queue: Model, nodeId: string): NodeIO | undefined => {
  if (nodeId === InputBoundaryNodeId)
    return {
      executionInputs: [],
      executionOutputs: [{ id: ExecutionIoId }],
      dataInputs: [],
      dataOutputs: queue.arguments,
    };
  if (nodeId === OutputBoundaryNodeId)
    return {
      executionInputs: [{ id: ExecutionIoId }],
      executionOutputs: [],
      dataInputs: queue.returns,
      dataOutputs: [],
    };
  return undefined;
};
export const enqueueIO = (queue: Model | undefined): NodeIO => ({
  executionInputs: [{ id: ExecutionIoId }],
  executionOutputs: [{ id: ExecutionIoId }],
  dataInputs: queue?.arguments ?? [],
  dataOutputs: queue?.returns ?? [],
});
export const packageModel: PackageModel = {
  id: packageId,
  name: "Queues",
  resources: [],
  schemas: [
    {
      id: EnqueueSchemaId,
      name: "Add to Queue",
      type: "exec",
      properties: [{ id: "queue", name: "Queue", type: { _tag: "String" }, optional: true }],
      ...enqueueIO(undefined),
    },
  ],
};
const boundarySchema = {
  package: PackageId.make("$macrograph"),
  schema: SchemaId.make("queue-boundary"),
};
export const boundaryNodes = (queue: Model): ReadonlyArray<NodeModel> => [
  {
    id: InputBoundaryNodeId,
    name: "Queue Input",
    properties: {},
    inputDefaults: {},
    foldPins: false,
    schema: boundarySchema,
    position: queue.inputPosition,
  },
  {
    id: OutputBoundaryNodeId,
    name: "Queue Output",
    properties: {},
    inputDefaults: {},
    foldPins: false,
    schema: boundarySchema,
    position: queue.outputPosition,
  },
];
export const projectCanvas = (queue: Model): Canvas.Model => ({
  ...queue.canvas,
  nodes: {
    ...queue.canvas.nodes,
    ...Object.fromEntries(boundaryNodes(queue).map((node) => [node.id, node])),
  },
});
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("QueueNotFoundError", {
  id: Schema.String,
}) {}
export class OperationError extends Schema.TaggedError<OperationError>()("QueueOperationError", {
  queueId: Schema.String,
  reason: Schema.String,
}) {}
export class EventNodeNotAllowedError extends Schema.TaggedError<EventNodeNotAllowedError>()(
  "QueueEventNodeNotAllowedError",
  { nodeId: Schema.String },
) {}
export class RecursiveEnqueueError extends Schema.TaggedError<RecursiveEnqueueError>()(
  "QueueRecursiveEnqueueError",
  { queueId: Schema.String, targetQueueId: Schema.String },
) {}
export class InvocationError extends Schema.TaggedError<InvocationError>()("QueueInvocationError", {
  queueId: Schema.String,
  reason: Schema.String,
}) {}

const enqueueTargets = (queue: Model, extra?: NodeModel): ReadonlyArray<string> =>
  [...Object.values(queue.canvas.nodes), ...(extra === undefined ? [] : [extra])].flatMap(
    (node) => {
      const target = node.properties.queue;
      return isEnqueue(node) && typeof target === "string" ? [target] : [];
    },
  );

export const validateNode = (
  queue: Model,
  node: NodeModel,
  schema: SchemaModel,
  queues: Readonly<Record<string, Model>>,
): Effect.Effect<void, EventNodeNotAllowedError | RecursiveEnqueueError> => {
  if (schema.type === "event")
    return Effect.fail(new EventNodeNotAllowedError({ nodeId: node.id }));
  if (!isEnqueue(node)) return Effect.void;
  const target = node.properties.queue;
  if (typeof target !== "string") return Effect.void;
  const ownerId = queue.canvas.id;
  const reachesOwner = (id: string, visited: ReadonlySet<string>): boolean => {
    if (id === ownerId) return true;
    if (visited.has(id)) return false;
    const candidate = queues[id];
    return (
      candidate !== undefined &&
      enqueueTargets(candidate).some((next) => reachesOwner(next, new Set([...visited, id])))
    );
  };
  return reachesOwner(target, new Set())
    ? Effect.fail(new RecursiveEnqueueError({ queueId: ownerId, targetQueueId: target }))
    : Effect.void;
};
export * as Queue from "./Queue.ts";
