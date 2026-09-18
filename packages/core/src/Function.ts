import { DataType } from "@macrograph/module/DataType";
import { Effect, Schema } from "effect";

import type { SchemaModel } from "./Package.ts";

import { Canvas } from "./Canvas.ts";
import { IoId, type NodeIO } from "./IO.ts";
import { NodeId, type Model as NodeModel } from "./Node.ts";
import { Position } from "./Position.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const InputBoundaryNodeId = NodeId.make("$function:input");
export const OutputBoundaryNodeId = NodeId.make("$function:output");
export const ExecutionIoId = IoId.make("exec");

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

export const validateNode = (
  _fn: Model,
  node: NodeModel,
  schema: SchemaModel,
): Effect.Effect<void, EventNodeNotAllowedError> =>
  schema.type === "event"
    ? Effect.fail(new EventNodeNotAllowedError({ nodeId: node.id }))
    : Effect.void;

export * as Function from "./Function.ts";
