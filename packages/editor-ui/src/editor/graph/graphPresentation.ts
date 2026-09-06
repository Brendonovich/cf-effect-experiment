import type { Graph, NodeIO } from "@macrograph/core";

import { OutputRef } from "@macrograph/core";
import { DataType as Types } from "@macrograph/module/DataType";
import { scopesCompatible } from "@macrograph/module/Registration";

import { visiblePorts, type PortDirection } from "./connectionAuthoring";
import { asOutputPort, type GraphPort } from "./GraphPort";
export type { GraphPort } from "./GraphPort";

type NodeIOFor = (nodeId: string) => NodeIO | undefined;
type DataType = NodeIO["dataInputs"][number]["type"];
type Position = { readonly x: number; readonly y: number };

export const GRAPH_NODE_FIRST_IO_Y = 42;
export const GRAPH_NODE_IO_SPACING = 28;
export const SCOPE_VERTICAL_PADDING = 6;
export const SCOPE_LEFT_PADDING = 10;
export const SCOPE_BORDER_WIDTH = 1;
const SCOPE_GROUP_INSET = SCOPE_VERTICAL_PADDING + SCOPE_BORDER_WIDTH;
export const GRAPH_GRID_SPACING = 40;

export interface PortGroup {
  readonly scope: string | undefined;
  readonly ports: ReadonlyArray<GraphPort>;
}

/** One item per ordinary pin, or one wrapper for a contiguous scope's pins. */
export const graphPortGroups = (ports: ReadonlyArray<GraphPort>): ReadonlyArray<PortGroup> => {
  const groups: Array<{ scope: string | undefined; ports: GraphPort[] }> = [];
  for (const port of ports) {
    const previous = groups[groups.length - 1];
    if (port.scopeGroup !== undefined && previous?.scope === port.scopeGroup)
      previous.ports.push(port);
    else groups.push({ scope: port.scopeGroup, ports: [port] });
  }
  return groups;
};

/** Each column lays itself out; scope padding never affects the opposite column. */
export const graphColumnLayout = (ports: ReadonlyArray<GraphPort>) => {
  let y = GRAPH_NODE_FIRST_IO_Y;
  const rows: Array<{ port: GraphPort; y: number }> = [];
  for (const group of graphPortGroups(ports)) {
    if (group.scope !== undefined) y += SCOPE_GROUP_INSET;
    for (const port of group.ports) {
      rows.push({ port, y });
      y += GRAPH_NODE_IO_SPACING;
    }
    if (group.scope !== undefined) y += SCOPE_GROUP_INSET;
  }
  return { rows, height: ports.length === 0 ? 0 : y - GRAPH_NODE_FIRST_IO_Y - 8 };
};

export const graphNodeHeight = (
  inputs: ReadonlyArray<GraphPort>,
  outputs: ReadonlyArray<GraphPort>,
  hasHiddenPins = false,
): number =>
  // Header (22), borders (4), body padding (16), then the taller column.
  42 +
  Math.max(graphColumnLayout(inputs).height, graphColumnLayout(outputs).height) +
  (hasHiddenPins ? 16 : 0);

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
  rowY = GRAPH_NODE_FIRST_IO_Y + index * GRAPH_NODE_IO_SPACING,
): Position => ({
  // GraphNode's border (2) + body padding (6) + half the pin width (7).
  x: direction === "output" ? width - 15 : 15,
  y: rowY,
});

export const graphNodeInputs = (io: NodeIO | undefined): ReadonlyArray<GraphPort> => [
  ...(io?.executionInputs.map((port) => ({
    id: port.id,
    ...(port.name === undefined ? {} : { name: port.name }),
    ...(port.scope === undefined
      ? { kind: "execution" as const }
      : { kind: "scope" as const, scope: port.scope }),
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

export const graphNodeOutputs = (
  io: NodeIO | undefined,
  splitScopes: ReadonlyArray<string> = [],
  connected: ReadonlyArray<OutputRef.Model> = [],
): ReadonlyArray<GraphPort> => [
  ...(io?.executionOutputs.flatMap((port): GraphPort[] => {
    const name = port.name === undefined ? {} : { name: port.name };
    const bundled = asOutputPort({
      id: port.id,
      ...name,
      ...(port.scope === undefined ? { kind: "execution" } : { kind: "scope", scope: port.scope }),
    });
    const split =
      splitScopes.includes(port.id) ||
      connected.some((ref) => ref._tag !== "Port" && ref.scope === port.id);
    if (!split || port.scope == null) return [bundled];
    const group = { scopeGroup: port.id };
    return [
      ...(connected.some((ref) => ref._tag === "Port" && ref.id === port.id) ? [bundled] : []),
      asOutputPort(
        { id: port.id, name: port.name ?? port.id, kind: "execution", ...group },
        OutputRef.scopeExec(port.id),
      ),
      ...port.scope.map((field) =>
        asOutputPort(
          { id: field.id, name: field.name ?? field.id, kind: "data", type: field.type, ...group },
          OutputRef.scopeField(port.id, field.id),
        ),
      ),
    ];
  }) ?? []),
  ...(io?.dataOutputs.map((port) =>
    asOutputPort({
      id: port.id,
      ...(port.name === undefined ? {} : { name: port.name }),
      type: port.type,
      kind: "data",
    }),
  ) ?? []),
];

export function graphNodeWidth(
  io: NodeIO | undefined,
  name = "",
  splitScopes: ReadonlyArray<string> = [],
  connected: ReadonlyArray<OutputRef.Model> = [],
): number {
  const input = Math.max(0, ...graphNodeInputs(io).map((port) => (port.name?.length ?? 0) * 6.5));
  const output = Math.max(
    0,
    ...graphNodeOutputs(io, splitScopes, connected).map(
      (port) =>
        (port.name?.length ?? 0) * 6.5 +
        (port.scopeGroup === undefined ? 0 : SCOPE_LEFT_PADDING + SCOPE_BORDER_WIDTH),
    ),
  );
  const hasDefaultControl =
    io?.dataInputs.some((port) => ["String", "Int", "Float", "Bool"].includes(port.type._tag)) ??
    false;
  const ioWidth = 72 + input + output + (hasDefaultControl ? 76 : 0);
  return Math.max(104, name.length * 6.5 + 16, ioWidth);
}

export const connectedPortIds = (graph: Graph.Model, nodeId: string, direction: PortDirection) =>
  new Set(
    graph.connections
      .filter((connection) =>
        direction === "input" ? connection.inNodeId === nodeId : connection.outNodeId === nodeId,
      )
      .map((connection) =>
        direction === "input" ? connection.inIoId : OutputRef.key(connection.outIo),
      ),
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
      : graphNodeOutputs(
          ioForNode(nodeId),
          node?.splitScopeOutputs,
          graph.connections.filter((wire) => wire.outNodeId === nodeId).map((wire) => wire.outIo),
        );
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
  const ports = visibleNodePorts(graph, ioForNode, nodeId, direction);
  const index = ports.findIndex((port) => port.id === ioId && port.kind === kind);
  if (index < 0) return undefined;
  const offset = graphPortOffset(
    graphNodeWidth(
      ioForNode(nodeId),
      node.name,
      node.splitScopeOutputs,
      graph.connections.filter((wire) => wire.outNodeId === nodeId).map((wire) => wire.outIo),
    ),
    direction,
    index,
    graphColumnLayout(ports).rows[index]?.y,
  );
  return {
    x: node.position.x + offset.x,
    y: node.position.y + offset.y,
  };
};

export const graphConnections = (graph: Graph.Model, ioForNode: NodeIOFor) => {
  // Index once per pass; scanning all connections for each endpoint is quadratic.
  const connected = new Map<string, Record<PortDirection, Set<string>>>();
  const outputRefs = new Map<string, OutputRef.Model[]>();
  for (const connection of graph.connections) {
    const refs = outputRefs.get(connection.outNodeId) ?? [];
    refs.push(connection.outIo);
    outputRefs.set(connection.outNodeId, refs);
    for (const [nodeId, direction, portId] of [
      [connection.outNodeId, "output", OutputRef.key(connection.outIo)],
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
    const width = graphNodeWidth(io, node.name, node.splitScopeOutputs, outputRefs.get(nodeId));
    const layout: Layout = { input: new Map(), output: new Map() };
    const visibleByDirection = {
      input: visiblePorts(
        retainedPorts(
          graphNodeInputs(io),
          connected.get(nodeId)!.input,
          Object.keys(node.inputDefaults),
        ),
        node.foldPins,
        connected.get(nodeId)!.input,
      ),
      output: visiblePorts(
        retainedPorts(
          graphNodeOutputs(io, node.splitScopeOutputs, outputRefs.get(nodeId)),
          connected.get(nodeId)!.output,
        ),
        node.foldPins,
        connected.get(nodeId)!.output,
      ),
    };
    for (const direction of ["input", "output"] as const) {
      const visible = visibleByDirection[direction];
      const { rows } = graphColumnLayout(visible);
      visible.forEach((port, index) => {
        const offset = graphPortOffset(width, direction, index, rows[index]?.y);
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
    const from = layoutForNode(connection.outNodeId)?.output.get(OutputRef.key(connection.outIo));
    const to = layoutForNode(connection.inNodeId)?.input.get(connection.inIoId);
    if (from === undefined || to === undefined) return [];
    const invalid =
      (from.port.kind === "data" && from.port.invalid) ||
      (to.port.kind === "data" && to.port.invalid)
        ? "Missing wire endpoint"
        : from.port.kind === "scope" &&
            to.port.kind === "scope" &&
            !scopesCompatible(from.port.scope, to.port.scope)
          ? "Scope fields do not match"
          : from.port.kind !== to.port.kind
            ? "Execution/data pin mismatch"
            : from.port.kind === "data" &&
                to.port.kind === "data" &&
                !Types.equals(from.port.type, to.port.type)
              ? "Nominal data types do not match"
              : undefined;
    if (invalid !== undefined) return [];
    return [
      {
        connection,
        from: from.position,
        to: to.position,
        type: from.port.kind === "data" ? from.port.type : undefined,
        ...(from.port.kind === "scope" ? { scope: true } : {}),
      },
    ];
  });
};

export const connectionPath = (from: Position, to: Position): string => {
  const control = Math.min(180, Math.hypot(to.x - from.x, to.y - from.y) / 2);
  return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`;
};

export const wireColor = (type: DataType | undefined, scope = false): string => {
  if (scope) return "#c084fc";
  if (type === undefined) return "white";
  const primary = type._tag === "List" ? type.item : type._tag === "Option" ? type.inner : type;
  switch (primary._tag) {
    case "String":
      return "#da5697";
    case "Wildcard":
      return "white";
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
