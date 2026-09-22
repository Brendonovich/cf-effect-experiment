import type * as Registration from "@macrograph/module/Registration";

import { Effect, Schema } from "effect";

import type { Canvas } from "./Canvas.ts";
import type { Node } from "./Node.ts";

import { IoId, type NodeIO, type ExecutionPort } from "./IO.ts";
import { NodeId } from "./Node.ts";
import * as OutputRef from "./OutputRef.ts";
import { Position } from "./Position.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const Projection = Schema.Struct({
  id: NodeId,
  position: Position,
});
export type Projection = typeof Projection.Type;

export const Collection = Schema.Record(Schema.String, Projection).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);
export type Collection = typeof Collection.Type;

export const ProjectionInputId = IoId.make("scope");
export const ProjectionExecutionId = IoId.make("exec");

export const emptyIO: NodeIO = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [{ id: ProjectionInputId, scope: null, name: "Scope" }],
  executionOutputs: [{ id: ProjectionExecutionId }],
};

const projectionSchema = {
  package: PackageId.make("$macrograph"),
  schema: SchemaId.make("scope-projection"),
};

export const isProjectionNode = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === projectionSchema.package &&
  node.schema.schema === projectionSchema.schema;

export const executionPort = (
  port: Registration.ExecutionInputRef | Registration.ExecutionOutputRef,
): ExecutionPort => ({
  id: IoId.make(port.id),
  ...(port.name === undefined ? {} : { name: port.name }),
  ...(port.scope === undefined
    ? {}
    : {
        scope:
          port.scope === null
            ? null
            : port.scope.map((field) => ({
                id: IoId.make(field.id),
                type: field.type,
                ...(field.name === undefined ? {} : { name: field.name }),
              })),
      }),
});

export const projectionNode = (projection: Projection): Node.Model => ({
  id: projection.id,
  name: "Break Scope",
  properties: {},
  inputDefaults: {},
  foldPins: false,
  schema: projectionSchema,
  position: projection.position,
});

export const projectCanvas = (canvas: Canvas.Model): Canvas.Model => ({
  ...canvas,
  nodes: {
    ...canvas.nodes,
    ...Object.fromEntries(
      Object.values(canvas.scopeProjections ?? {}).map((projection) => [
        projection.id,
        projectionNode(projection),
      ]),
    ),
  },
});

export const binding = (canvas: Canvas.Model, projectionId: string) => {
  const connections = canvas.connections.filter(
    (wire) => wire.inNodeId === projectionId && wire.inIoId === ProjectionInputId,
  );
  return connections.length === 1 ? connections[0] : undefined;
};

/** Projection IO is derived from its single incoming scope wire. */
export const projectionIO = (
  canvas: Canvas.Model,
  projectionId: string,
  ioForNode: (nodeId: string) => NodeIO | undefined,
): NodeIO => {
  const wire = binding(canvas, projectionId);
  const sourceOutput = wire?.outIo;
  const scope =
    wire !== undefined && sourceOutput?._tag === "Port"
      ? ioForNode(wire.outNodeId)?.executionOutputs.find((port) => port.id === sourceOutput.id)
      : undefined;
  return {
    ...emptyIO,
    dataOutputs: scope?.scope ?? [],
  };
};

/** Remove presentation-only projections by wiring their consumers to scope projections. */
export const lowerProjections = (canvas: Canvas.Model): Canvas.Model => {
  const projectionIds = new Set(Object.keys(canvas.scopeProjections ?? {}));
  const bindings = new Map(
    [...projectionIds].flatMap((id) => {
      const wire = binding(canvas, id);
      return wire?.outIo._tag === "Port" ? [[id, wire] as const] : [];
    }),
  );
  return {
    ...canvas,
    scopeProjections: {},
    connections: canvas.connections.flatMap((wire) => {
      if (projectionIds.has(wire.inNodeId)) return [];
      const source = bindings.get(wire.outNodeId);
      if (source === undefined || source.outIo._tag !== "Port" || wire.outIo._tag !== "Port")
        return [wire];
      return [
        {
          ...wire,
          outNodeId: source.outNodeId,
          outIo:
            wire.outIo.id === ProjectionExecutionId
              ? OutputRef.scopeExec(source.outIo.id)
              : OutputRef.scopeField(source.outIo.id, wire.outIo.id),
        },
      ];
    }),
  };
};
