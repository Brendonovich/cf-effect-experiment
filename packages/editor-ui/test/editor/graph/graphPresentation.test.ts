import {
  ConnectionId,
  Graph,
  IoId,
  NodeId,
  PackageId,
  SchemaId,
  type NodeIO,
} from "@macrograph/core";
import { describe, expect, it, vi } from "vitest";

import { graphConnections, handlePosition, wireColor } from "../../../src/editor/graph/graphPresentation";

const outputId = IoId.make("output");
const inputId = IoId.make("connected");
const hiddenId = IoId.make("hidden");

const graph: Graph.Model = {
  ...Graph.empty("graph"),
  nodes: Object.fromEntries(
    ["source", "target"].map((id, index) => [
      id,
      {
        id: NodeId.make(id),
        name: id,
        properties: {},
        inputDefaults: {},
        foldPins: id === "target",
        schema: { package: PackageId.make("package"), schema: SchemaId.make("schema") },
        position: { x: index * 200, y: 0 },
      },
    ]),
  ),
  connections: [
    {
      id: ConnectionId.make("connection"),
      outNodeId: "source",
      outIoId: outputId,
      inNodeId: "target",
      inIoId: inputId,
    },
  ],
};

const ioByNode: Record<string, NodeIO> = {
  source: {
    dataInputs: [],
    dataOutputs: [{ id: outputId, type: { _tag: "String" } }],
    executionInputs: [],
    executionOutputs: [],
  },
  target: {
    dataInputs: [
      { id: hiddenId, type: { _tag: "String" } },
      { id: inputId, type: { _tag: "String" } },
    ],
    dataOutputs: [],
    executionInputs: [],
    executionOutputs: [],
  },
};

describe("graph presentation", () => {
  it("positions connected ports using the folded node's visible rows", () => {
    const [connection] = graphConnections(graph, (nodeId) => ioByNode[nodeId]);

    expect(connection?.to).toEqual({ x: 215, y: 42 });
    expect(connection?.type).toEqual({ _tag: "String" });
  });

  it("ignores ambiguous connections that match execution and data ports", () => {
    const ambiguous: NodeIO = {
      ...ioByNode.source!,
      executionOutputs: [{ id: outputId }],
    };

    expect(
      graphConnections(graph, (nodeId) => (nodeId === "source" ? ambiguous : ioByNode[nodeId])),
    ).toEqual([]);
  });

  it("uses the same colors for scalar, nested, and execution wires", () => {
    expect(wireColor({ _tag: "String" })).toBe("#da5697");
    expect(wireColor({ _tag: "Int" })).toBe("#30f3db");
    expect(wireColor({ _tag: "List", item: { _tag: "Option", inner: { _tag: "Bool" } } })).toBe(
      "#dc2626",
    );
    expect(wireColor(undefined)).toBe("white");
  });

  it.each([false, true])(
    "preserves mixed data/execution port positions when folded=%s",
    (foldPins) => {
      const mixedGraph: Graph.Model = {
        ...graph,
        nodes: Object.fromEntries(
          Object.entries(graph.nodes).map(([id, node]) => [id, { ...node, foldPins }]),
        ),
        connections: [
          ...graph.connections,
          {
            id: ConnectionId.make("exec"),
            outNodeId: "source",
            outIoId: IoId.make("exec-out"),
            inNodeId: "target",
            inIoId: IoId.make("exec-in"),
          },
        ],
      };
      const mixedIO: Record<string, NodeIO> = {
        source: { ...ioByNode.source!, executionOutputs: [{ id: IoId.make("exec-out") }] },
        target: { ...ioByNode.target!, executionInputs: [{ id: IoId.make("exec-in") }] },
      };
      const ioForNode = (nodeId: string) => mixedIO[nodeId];
      const edges = graphConnections(mixedGraph, ioForNode);
      expect(edges).toHaveLength(2);
      for (const edge of edges) {
        const kind = edge.type === undefined ? "execution" : "data";
        expect(edge.from).toEqual(
          handlePosition(
            mixedGraph,
            ioForNode,
            edge.connection.outNodeId,
            edge.connection.outIoId,
            "output",
            kind,
          ),
        );
        expect(edge.to).toEqual(
          handlePosition(
            mixedGraph,
            ioForNode,
            edge.connection.inNodeId,
            edge.connection.inIoId,
            "input",
            kind,
          ),
        );
      }
    },
  );

  it("ignores missing nodes, missing ports, and duplicate port IDs", () => {
    expect(graphConnections({ ...graph, nodes: {} }, (id) => ioByNode[id])).toEqual([]);
    expect(graphConnections(graph, () => undefined)).toEqual([]);
    for (const nodeId of ["source", "target"]) {
      const io = ioByNode[nodeId]!;
      const duplicateIO: NodeIO = {
        ...io,
        dataInputs: [...io.dataInputs, ...io.dataInputs],
        dataOutputs: [...io.dataOutputs, ...io.dataOutputs],
      };
      expect(graphConnections(graph, (id) => (id === nodeId ? duplicateIO : ioByNode[id]))).toEqual(
        [],
      );
    }
  });

  it("indexes shared node ports once instead of rescanning connections for every wire", () => {
    const connections = Array.from({ length: 1000 }, (_, index) => ({
      ...graph.connections[0]!,
      id: ConnectionId.make(`connection-${index}`),
    }));
    let connectionReads = 0;
    const manyWires: Graph.Model = {
      ...graph,
      get connections() {
        connectionReads++;
        return connections;
      },
    };
    const ioForNode = vi.fn((nodeId: string) => ioByNode[nodeId]);
    const edges = graphConnections(manyWires, ioForNode);

    expect(edges).toHaveLength(1000);
    expect(edges[0]?.to).toEqual({ x: 215, y: 42 });
    expect(ioForNode).toHaveBeenCalledTimes(2);
    expect(connectionReads).toBeLessThanOrEqual(2);
  });
});
