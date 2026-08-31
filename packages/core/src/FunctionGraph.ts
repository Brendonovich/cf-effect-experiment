import type { Graph } from "./Graph.ts";
import type { Package } from "./Package.ts";
import type { Project } from "./Project.ts";

import { ConnectionId } from "./Connection.ts";
import { IoId, type NodeIO } from "./IO.ts";
import { NodeId, type Node } from "./Node.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const packageId = PackageId.make("macrograph-functions");
export const queuePackageId = PackageId.make("macrograph-queues");
export const isQueuedCall = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === queuePackageId && node.schema.schema === "add";
export const isFunctionNode = (node: Pick<Node.Model, "schema">) =>
  node.schema.package === packageId || isQueuedCall(node);
export const isBoundary = (node: Pick<Node.Model, "schema">) =>
  isFunctionNode(node) && (node.schema.schema === "input" || node.schema.schema === "output");
export const isCall = (node: Pick<Node.Model, "schema">) =>
  (node.schema.package === packageId && node.schema.schema === "call") || isQueuedCall(node);

export const validateProject = (project: Project.Model): string | undefined => {
  for (const graph of Object.values(project.graphs)) {
    const boundaries = Object.values(graph.nodes).filter(isBoundary);
    if (graph.kind !== "function") {
      if (boundaries.length > 0)
        return `Ordinary graph ${graph.id} contains system-owned function boundaries`;
    } else {
      if (
        graph.signature === undefined ||
        boundaries.filter((node) => node.schema.schema === "input").length !== 1 ||
        boundaries.filter((node) => node.schema.schema === "output").length !== 1
      )
        return `Function ${graph.id} requires a signature and exactly one Input and Output boundary`;
      for (const fields of [graph.signature.inputs, graph.signature.outputs]) {
        if (
          new Set(fields.map((field) => field.id)).size !== fields.length ||
          fields.some((field) => !field.id || !field.name.trim())
        )
          return `Function ${graph.id} has invalid field IDs or names`;
      }
      if (boundaries.some((node) => Object.keys(node.properties).length > 0))
        return `Function ${graph.id} has non-system boundary properties`;
    }
  }
};

export const io = (schemaId: string, signature?: Graph.FunctionSignature): NodeIO => {
  const schema = schemaId === "add" ? "call" : schemaId;
  return {
    executionInputs: schema === "input" ? [] : [{ id: IoId.make("exec") }],
    executionOutputs: schema === "output" ? [] : [{ id: IoId.make("exec") }],
    dataInputs:
      (schema === "output" ? signature?.outputs : schema === "call" ? signature?.inputs : [])?.map(
        (field) => ({
          ...field,
          id: IoId.make(`${schema === "output" ? "gout" : "in"}:${field.id}`),
        }),
      ) ?? [],
    dataOutputs:
      (schema === "input" ? signature?.inputs : schema === "call" ? signature?.outputs : [])?.map(
        (field) => ({
          ...field,
          id: IoId.make(`${schema === "input" ? "gin" : "out"}:${field.id}`),
        }),
      ) ?? [],
  };
};

export const pkg: Package.Model = {
  id: packageId,
  name: "Functions",
  resources: [],
  schemas: ["input", "output", "call"].map((id) => ({
    id: SchemaId.make(id),
    name:
      id === "call" ? "Execute Function" : id === "input" ? "Function Input" : "Function Output",
    type: "exec",
    internal: id !== "call",
    properties:
      id === "call"
        ? [{ id: "function", name: "Function", type: { _tag: "String" }, optional: true }]
        : [],
    ...io(id),
  })),
};

export const queuesPackage: Package.Model = {
  id: queuePackageId,
  name: "Queues",
  resources: [],
  schemas: [
    {
      id: SchemaId.make("add"),
      name: "Add to Queue",
      type: "exec",
      properties: [
        { id: "queue", name: "Queue", type: { _tag: "String" }, optional: true },
        { id: "function", name: "Function", type: { _tag: "String" }, optional: true },
      ],
      ...io("call"),
    },
  ],
};

export const generate = (graph: Graph.Model, newId: () => string): Graph.Model => {
  const nodes = ["input", "output"].map(
    (schema, index): Node.Model => ({
      id: NodeId.make(newId()),
      name: index === 0 ? "Function Input" : "Function Output",
      schema: { package: packageId, schema: SchemaId.make(schema) },
      position: { x: index * 400, y: 0 },
      properties: {},
      inputDefaults: {},
      foldPins: false,
    }),
  );
  return {
    ...graph,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    connections: [
      {
        id: ConnectionId.make(newId()),
        outNodeId: nodes[0]!.id,
        outIoId: IoId.make("exec"),
        inNodeId: nodes[1]!.id,
        inIoId: IoId.make("exec"),
      },
    ],
  };
};
