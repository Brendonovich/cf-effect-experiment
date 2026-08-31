import type { Graph, NodeIO } from "@macrograph/core";

import { DataType as Types } from "@macrograph/plugin/DataType";

import { visiblePorts, type PortDirection } from "./connectionAuthoring";

type NodeIOFor = (nodeId: string) => NodeIO | undefined;
type DataType = NodeIO["dataInputs"][number]["type"];
type Position = { readonly x: number; readonly y: number };

export const GRAPH_NODE_FIRST_IO_Y = 42;
export const GRAPH_NODE_IO_SPACING = 28;
export const GRAPH_GRID_SPACING = 40;

export const snapGraphPosition = (position: Position, shiftKey = false): Position =>
  shiftKey
    ? position
    : {
        x: Math.round(position.x / GRAPH_GRID_SPACING) * GRAPH_GRID_SPACING,
        y: Math.round(position.y / GRAPH_GRID_SPACING) * GRAPH_GRID_SPACING,
      };

export const graphPortOffset = (
  width: number,
  direction: PortDirection,
  index: number,
): Position => ({
  // GraphNode's border (2) + port padding (6) + half the pin width (7).
  x: direction === "output" ? width - 15 : 15,
  y: GRAPH_NODE_FIRST_IO_Y + index * GRAPH_NODE_IO_SPACING,
});

export type GraphPort =
  | { readonly kind: "execution"; readonly id: string; readonly name?: string }
  | {
      readonly kind: "data";
      readonly id: string;
      readonly name?: string;
      readonly type: DataType;
      readonly invalid?: boolean;
    };

export const graphNodeInputs = (io: NodeIO | undefined): ReadonlyArray<GraphPort> => [
  ...(io?.executionInputs.map((port) => ({
    id: port.id,
    ...(port.name === undefined ? {} : { name: port.name }),
    kind: "execution" as const,
  })) ?? []),
  ...(io?.dataInputs.map((port) => ({
    id: port.id,
    ...(port.name === undefined ? {} : { name: port.name }),
    type: port.type,
    kind: "data" as const,
  })) ?? []),
];

export const retainedPorts = (
  ports: ReadonlyArray<GraphPort>,
  connectedIds: ReadonlySet<string>,
  defaultIds: readonly string[] = [],
): ReadonlyArray<GraphPort> => {
  const known = new Set(ports.map((port) => port.id));
  return [
    ...ports,
    ...[...new Set([...connectedIds, ...defaultIds])]
      .filter((id) => !known.has(id))
      .map((id) => ({
        kind: "data" as const,
        id,
        name: `Missing: ${id}`,
        type: Types.String,
        invalid: true,
      })),
  ];
};

export const graphNodeOutputs = (io: NodeIO | undefined): ReadonlyArray<GraphPort> => [
  ...(io?.executionOutputs.map((port) => ({
    id: port.id,
    ...(port.name === undefined ? {} : { name: port.name }),
    kind: "execution" as const,
  })) ?? []),
  ...(io?.dataOutputs.map((port) => ({
    id: port.id,
    ...(port.name === undefined ? {} : { name: port.name }),
    type: port.type,
    kind: "data" as const,
  })) ?? []),
];

export function graphNodeWidth(io: NodeIO | undefined, name = ""): number {
  const input = Math.max(
    0,
    ...graphNodeInputs(io).map((port) =>
      port.kind === "data" ? (port.name || port.id).length : 0,
    ),
  );
  const output = Math.max(
    0,
    ...graphNodeOutputs(io).map((port) =>
      port.kind === "data" ? (port.name || port.id).length : 0,
    ),
  );
  const hasDefaultControl =
    io?.dataInputs.some((port) => ["String", "Int", "Float", "Bool"].includes(port.type._tag)) ??
    false;
  const ioWidth = 72 + (input + output) * 6.5 + (hasDefaultControl ? 76 : 0);
  return Math.max(104, name.length * 6.5 + 16, ioWidth);
}

export const connectedPortIds = (graph: Graph.Model, nodeId: string, direction: PortDirection) =>
  new Set(
    graph.connections
      .filter((connection) =>
        direction === "input" ? connection.inNodeId === nodeId : connection.outNodeId === nodeId,
      )
      .map((connection) => (direction === "input" ? connection.inIoId : connection.outIoId)),
  );

export const visibleNodePorts = (
  graph: Graph.Model,
  ioForNode: NodeIOFor,
  nodeId: string,
  direction: PortDirection,
): ReadonlyArray<GraphPort> => {
  const node = graph.nodes[nodeId];
  const ports =
    direction === "input"
      ? graphNodeInputs(ioForNode(nodeId))
      : graphNodeOutputs(ioForNode(nodeId));
  const connected = connectedPortIds(graph, nodeId, direction);
  return visiblePorts(
    retainedPorts(
      ports,
      connected,
      direction === "input" ? Object.keys(node?.inputDefaults ?? {}) : [],
    ),
    node?.foldPins === true,
    connected,
  );
};

export const handlePosition = (
  graph: Graph.Model,
  ioForNode: NodeIOFor,
  nodeId: string,
  ioId: string,
  direction: PortDirection,
  kind: GraphPort["kind"],
): Position | undefined => {
  const node = graph.nodes[nodeId];
  if (node === undefined) return undefined;
  const index = visibleNodePorts(graph, ioForNode, nodeId, direction).findIndex(
    (port) => port.id === ioId && port.kind === kind,
  );
  if (index < 0) return undefined;
  const offset = graphPortOffset(graphNodeWidth(ioForNode(nodeId), node.name), direction, index);
  return {
    x: node.position.x + offset.x,
    y: node.position.y + offset.y,
  };
};

export const graphConnections = (graph: Graph.Model, ioForNode: NodeIOFor) => {
  // Index once per pass; scanning all connections for each endpoint is quadratic.
  const connected = new Map<string, Record<PortDirection, Set<string>>>();
  for (const connection of graph.connections) {
    for (const [nodeId, direction, portId] of [
      [connection.outNodeId, "output", connection.outIoId],
      [connection.inNodeId, "input", connection.inIoId],
    ] as const) {
      let ports = connected.get(nodeId);
      if (ports === undefined) {
        ports = { input: new Set(), output: new Set() };
        connected.set(nodeId, ports);
      }
      ports[direction].add(portId);
    }
  }

  type Endpoint = { port: GraphPort; position: Position };
  type Layout = Record<PortDirection, Map<string, Endpoint | undefined>>;
  const layouts = new Map<string, Layout>();
  const layoutForNode = (nodeId: string) => {
    const cached = layouts.get(nodeId);
    if (cached !== undefined) return cached;
    const node = graph.nodes[nodeId];
    if (node === undefined) return undefined;
    const io = ioForNode(node.id);
    const width = graphNodeWidth(io, node.name);
    const layout: Layout = { input: new Map(), output: new Map() };
    for (const direction of ["input", "output"] as const) {
      const ports = direction === "input" ? graphNodeInputs(io) : graphNodeOutputs(io);
      const ids = connected.get(nodeId)![direction];
      const visible = visiblePorts(
        retainedPorts(ports, ids, direction === "input" ? Object.keys(node.inputDefaults) : []),
        node.foldPins,
        ids,
      );
      visible.forEach((port, index) => {
        const offset = graphPortOffset(width, direction, index);
        // Duplicate IDs, including IDs shared by data and execution pins, are ambiguous.
        layout[direction].set(
          port.id,
          layout[direction].has(port.id)
            ? undefined
            : { port, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } },
        );
      });
    }
    layouts.set(nodeId, layout);
    return layout;
  };

  return graph.connections.flatMap((connection) => {
    const from = layoutForNode(connection.outNodeId)?.output.get(connection.outIoId);
    const to = layoutForNode(connection.inNodeId)?.input.get(connection.inIoId);
    if (from === undefined || to === undefined) return [];
    const invalid =
      (from.port.kind === "data" && from.port.invalid) ||
      (to.port.kind === "data" && to.port.invalid)
        ? "Missing wire endpoint"
        : from.port.kind !== to.port.kind
          ? "Execution/data pin mismatch"
          : from.port.kind === "data" &&
              to.port.kind === "data" &&
              !Types.equals(from.port.type, to.port.type)
            ? "Nominal data types do not match"
            : undefined;
    return [
      {
        connection,
        from: from.position,
        to: to.position,
        type: from.port.kind === "data" ? from.port.type : undefined,
        invalid,
      },
    ];
  });
};

export const connectionPath = (from: Position, to: Position): string => {
  const control = Math.min(180, Math.hypot(to.x - from.x, to.y - from.y) / 2);
  return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`;
};

export const wireColor = (type: DataType | undefined): string => {
  if (type === undefined) return "white";
  const primary = type._tag === "List" ? type.item : type._tag === "Option" ? type.inner : type;
  switch (primary._tag) {
    case "String":
      return "#da5697";
    case "Int":
      return "#30f3db";
    case "Float":
      return "#00ae75";
    case "Bool":
      return "#dc2626";
    case "DateTime":
      return "#3b82f6";
    case "Custom":
      return `hsl(${[...primary.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 360} 70% 72%)`;
    case "List":
    case "Option":
      return wireColor(primary);
  }
};
