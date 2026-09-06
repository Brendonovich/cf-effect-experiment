import * as Registration from "@macrograph/module/Registration";
import { Effect, Result } from "effect";

import type { Graph } from "./Graph.ts";
import type { Node } from "./Node.ts";
import type { Package } from "./Package.ts";
import type * as SchemaAuthoring from "./SchemaAuthoring.ts";

import { IoId, type NodeIO, type ExecutionPort } from "./IO.ts";
import * as OutputRef from "./OutputRef.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const packageId = PackageId.make("Scopes");
export const isBreakScope = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId && node.schema.schema === "BreakScope";

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

export const schema: Registration.RegisteredSchema = {
  id: "BreakScope",
  name: "Break Scope",
  type: "base",
  properties: [],
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [new Registration.ScopeInputRef("scope", null, "Scope")],
  executionOutputs: [new Registration.ExecutionOutputRef("exec")],
  generateIO: () => schema,
  matches: () => Effect.succeed(false),
  // The executor materializes the connected fields before continuing execution.
  run: () => Effect.void,
};

export const emptyIO: NodeIO = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: schema.executionInputs.map(executionPort),
  executionOutputs: schema.executionOutputs.map(executionPort),
};

export const authoring: Readonly<Record<string, SchemaAuthoring.Definition>> = {
  BreakScope: {
    generateIO: (context) =>
      Result.succeed({
        ...emptyIO,
        dataOutputs: context.inputScope("scope") ?? [],
      }),
  },
};

export const packageModel: Package.Model = {
  id: packageId,
  name: "Scopes",
  resources: [],
  schemas: [
    {
      id: SchemaId.make(schema.id),
      name: schema.name,
      type: schema.type,
      properties: [],
      ...emptyIO,
    },
  ],
};

/** Derived from the wire, never persisted as a second copy of its source's type. */
export const resolveIO = (
  graph: Graph.Model,
  nodeId: string,
  ioForNode: (nodeId: string) => NodeIO | undefined,
): NodeIO | undefined => {
  const node = graph.nodes[nodeId];
  if (node === undefined || !isBreakScope(node)) return ioForNode(nodeId);
  const connections = graph.connections.filter(
    (wire) => wire.inNodeId === nodeId && wire.inIoId === "scope",
  );
  const wire = connections.length === 1 ? connections[0] : undefined;
  const fields =
    wire === undefined
      ? undefined
      : wire.outIo._tag === "Port"
        ? ioForNode(wire.outNodeId)?.executionOutputs.find(
            (port) => port.id === OutputRef.parentId(wire.outIo),
          )?.scope
        : undefined;
  const result = authoring.BreakScope!.generateIO!({
    properties: node.properties,
    definitions: {},
    declared: emptyIO,
    resolve: (type) => type,
    inputScope: () => fields ?? undefined,
  });
  return Result.isSuccess(result) ? result.success : emptyIO;
};
