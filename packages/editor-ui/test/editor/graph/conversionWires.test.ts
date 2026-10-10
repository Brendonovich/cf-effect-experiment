import {
  Canvas,
  ConnectionId,
  IoId,
  NodeId,
  PackageId,
  SchemaId,
  type NodeIO,
} from "@macrograph/core";
import { Conversion, t } from "@macrograph/module";
import { describe, expect, it } from "vitest";

import { graphConnections, wireSegments } from "../../../src/editor/graph/graphPresentation";

const outputId = IoId.make("output");
const inputId = IoId.make("connected");

const graph: Canvas.Model = {
  ...Canvas.empty("graph"),
  nodes: Object.fromEntries(
    ["source", "target"].map((id, index) => [
      id,
      {
        id: NodeId.make(id),
        name: id,
        properties: {},
        inputDefaults: {},
        foldPins: false,
        schema: { package: PackageId.make("package"), schema: SchemaId.make("schema") },
        position: { x: index * 200, y: 0 },
      },
    ]),
  ),
  connections: [
    {
      id: ConnectionId.make("connection"),
      outNodeId: "source",
      outIo: { _tag: "Port" as const, id: outputId },
      inNodeId: "target",
      inIoId: inputId,
    },
  ],
};

const io = (outputType: t.Type, inputType: t.Type): Record<string, NodeIO> => ({
  source: {
    dataInputs: [],
    dataOutputs: [{ id: outputId, type: outputType }],
    executionInputs: [],
    executionOutputs: [],
  },
  target: {
    dataInputs: [{ id: inputId, type: inputType }],
    dataOutputs: [],
    executionInputs: [],
    executionOutputs: [],
  },
});

const Code = t.defineStruct("chat/Code", "Code", {});
const moduleRules = Conversion.rules([
  ...Conversion.defaults,
  { from: t.Struct(Code), to: t.String },
]);

const points = (path: string) =>
  [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

describe("converted wires", () => {
  it("omits a wire with no conversion in that direction", () => {
    const ioByNode = io(t.Float, t.Int);
    expect(graphConnections(graph, (id) => ioByNode[id])).toEqual([]);
  });

  it("shows a core default Int to Float wire with its destination type", () => {
    const ioByNode = io(t.Int, t.Float);
    const [edge] = graphConnections(graph, (id) => ioByNode[id]);
    expect(edge?.type).toEqual(t.Int);
    expect(edge?.targetType).toEqual(t.Float);
  });

  it("shows a wire only when the rules include a module's pair", () => {
    const ioByNode = io(t.Struct(Code), t.String);
    expect(graphConnections(graph, (id) => ioByNode[id])).toEqual([]);
    const [edge] = graphConnections(graph, (id) => ioByNode[id], undefined, moduleRules);
    expect(edge?.targetType).toEqual(t.String);
  });

  it("omits targetType when the endpoint types are equal", () => {
    const ioByNode = io(t.Float, t.Float);
    const [edge] = graphConnections(graph, (id) => ioByNode[id]);
    expect(edge).toBeDefined();
    expect(edge?.targetType).toBeUndefined();
  });

  it("draws a converted wire with two close vertical ticks at the color handoff", () => {
    const ioByNode = io(t.Int, t.Float);
    const [edge] = graphConnections(graph, (id) => ioByNode[id]);
    const segments = wireSegments(edge!);
    const wires = segments.filter((segment) => segment.kind === "wire");
    const markers = segments.filter((segment) => segment.kind === "conversion-marker");
    expect(wires.map((segment) => segment.stroke)).toEqual(["#30f3db", "#00ae75"]);
    expect(markers.map((segment) => segment.stroke)).toEqual(["#30f3db", "#00ae75"]);
    const first = points(wires[0]!.path);
    const second = points(wires[1]!.path);
    expect(first.slice(0, 2)).toEqual([edge!.from.x, edge!.from.y]);
    expect(second.slice(-2)).toEqual([edge!.to.x, edge!.to.y]);
    expect(first.slice(-2)).not.toEqual(second.slice(0, 2));
    const sourceMarker = points(markers[0]!.path);
    const targetMarker = points(markers[1]!.path);
    expect(sourceMarker).toEqual([
      first.at(-2),
      first.at(-1)! - 4,
      first.at(-2),
      first.at(-1)! + 4,
    ]);
    expect(targetMarker).toEqual([second[0], second[1]! - 4, second[0], second[1]! + 4]);
  });

  it("draws a single segment when the source and destination colors match", () => {
    const ioByNode = io(t.Float, t.Float);
    const [edge] = graphConnections(graph, (id) => ioByNode[id]);
    expect(wireSegments(edge!)).toEqual([
      expect.objectContaining({ kind: "wire", stroke: "#00ae75" }),
    ]);
  });
});
