import { Actor, ConnectionId, IoId, NodeId, Project, Scopes, OutputRef } from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { Schema } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

import {
  compatibleSchemaPorts,
  portsCompatible,
  visiblePorts,
} from "../../src/editor/graph/connectionAuthoring";
import {
  graphConnections,
  graphNodeInputs,
  graphNodeOutputs,
  graphColumnLayout,
  graphPortGroups,
  graphNodeHeight,
  graphPortOffset,
} from "../../src/editor/graph/graphPresentation";
import { createEditorStore } from "../../src/editor/store";

const field = { id: IoId.make("value"), name: "Value", type: DataType.String };
const io = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [],
  executionOutputs: [{ id: IoId.make("found"), name: "Found", scope: [field] }],
};
const project = Schema.decodeUnknownSync(Project.Model)({
  ...Project.empty(),
  graphs: {
    graph: {
      id: "graph",
      name: "Graph",
      connections: [],
      nodes: Object.fromEntries(
        [
          ["source", { package: "test", schema: "source" }],
          ["break", { package: Scopes.packageId, schema: "BreakScope" }],
        ].map(([id, schema]) => [
          id,
          {
            id,
            name: id,
            schema,
            properties: {},
            inputDefaults: {},
            foldPins: false,
            position: { x: 0, y: 0 },
          },
        ]),
      ),
    },
  },
});

describe("scope authoring", () => {
  it("lays input and output columns out independently, grouping scope pins in wrappers", () => {
    const twoScopes = graphNodeOutputs(
      {
        ...io,
        executionOutputs: [
          io.executionOutputs[0]!,
          { ...io.executionOutputs[0]!, id: IoId.make("second"), name: "Longer branch" },
        ],
      },
      ["found", "second"],
    );
    const inputs = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      kind: "execution" as const,
    }));
    const inputLayout = graphColumnLayout(inputs);
    const outputLayout = graphColumnLayout(twoScopes);
    expect(inputLayout.rows.map((row) => row.y)).toEqual([42, 70, 98, 126]);
    expect(outputLayout.rows.map((row) => row.y)).toEqual([49, 77, 119, 147]);
    expect(graphPortOffset(200, "input", 2, inputLayout.rows[2]!.y).y).toBe(98);
    expect(graphPortOffset(200, "output", 2, outputLayout.rows[2]!.y).y).toBe(119);
    expect(graphPortGroups(twoScopes).map((group) => [group.scope, group.ports.length])).toEqual([
      ["found", 2],
      ["second", 2],
    ]);
    expect(graphPortGroups(inputs)).toHaveLength(4);
    expect(inputLayout.height).toBe(104);
    expect(outputLayout.height).toBe(132);
    expect(graphNodeHeight(inputs, twoScopes)).toBe(174);
    expect(graphNodeHeight(inputs, twoScopes.slice(0, 2))).toBe(146);
    expect(graphNodeHeight([], [])).toBe(42);
    expect(graphColumnLayout([])).toEqual({ rows: [], height: 0 });
  });
  it("exposes branch-as-exec and field pins with collision-free identities and keeps the heading when folded", () => {
    const outputs = graphNodeOutputs(io, ["found"]);
    expect(outputs.map((port) => [port.kind, port.name, port.scopeGroup, port.outputRef])).toEqual([
      ["execution", "Found", "found", OutputRef.scopeExec("found")],
      ["data", "Value", "found", OutputRef.scopeField("found", "value")],
    ]);
    expect(new Set(outputs.map((port) => port.id)).size).toBe(2);
    expect(
      visiblePorts(outputs, true, new Set([OutputRef.key(OutputRef.scopeField("found", "value"))])),
    ).toEqual(outputs);
    expect(graphNodeOutputs(io, [], [OutputRef.scopeField("found", "value")])).toEqual(outputs);
    expect(OutputRef.key(OutputRef.port(outputs[0]!.id))).not.toBe(outputs[0]!.id);
  });

  it("applies collaborative split/bundle events without introducing another node", () =>
    createRoot((dispose) => {
      const editor = createEditorStore();
      editor.setProject(project, { graph: { source: io, break: Scopes.emptyIO } });
      editor.applyEvent({
        _tag: "NodeScopeSplitChanged",
        actor: Actor.system,
        graphId: "graph",
        nodeId: "source",
        splitScopeOutputs: [IoId.make("found")],
      });
      expect(editor.store.project?.graphs.graph?.nodes.source?.splitScopeOutputs).toEqual([
        "found",
      ]);
      expect(Object.keys(editor.store.project!.graphs.graph!.nodes)).toEqual(["source", "break"]);
      expect(
        graphNodeOutputs(
          editor.store.nodeIO.graph?.source,
          editor.store.project?.graphs.graph?.nodes.source?.splitScopeOutputs,
        ),
      ).toHaveLength(2);
      editor.applyEvent({
        _tag: "NodeScopeSplitChanged",
        actor: Actor.system,
        graphId: "graph",
        nodeId: "source",
        splitScopeOutputs: [],
      });
      expect(
        graphNodeOutputs(
          editor.store.nodeIO.graph?.source,
          editor.store.project?.graphs.graph?.nodes.source?.splitScopeOutputs,
        )[0]?.kind,
      ).toBe("scope");
      dispose();
    }));
  it("renders scope ports distinctly and only offers compatible connections", () => {
    const output = graphNodeOutputs(io)[0]!;
    const input = graphNodeInputs(Scopes.emptyIO)[0]!;
    expect(output.kind).toBe("scope");
    expect(input.kind).toBe("scope");
    expect(portsCompatible(output, input)).toBe(true);
    expect(portsCompatible(input, output)).toBe(true);
    expect(portsCompatible(output, { id: "exec", kind: "execution" })).toBe(false);
    expect(portsCompatible(output, { id: "value", kind: "data", type: DataType.String })).toBe(
      false,
    );
    expect(
      portsCompatible(output, {
        ...input,
        kind: "scope",
        scope: [{ ...field, type: DataType.Int }],
      }),
    ).toBe(false);
    expect(
      compatibleSchemaPorts(Scopes.packageModel.schemas[0]!, { direction: "output", port: output }),
    ).toEqual([input]);
  });

  it("updates inferred fields after remote connect, source IO change, disconnect, and source deletion", () =>
    createRoot((dispose) => {
      const editor = createEditorStore();
      editor.setProject(project, { graph: { source: io, break: Scopes.emptyIO } });
      const connection = {
        id: ConnectionId.make("scope"),
        outNodeId: "source",
        outIo: { _tag: "Port" as const, id: IoId.make("found") },
        inNodeId: "break",
        inIoId: IoId.make("scope"),
      };
      const connect = () =>
        editor.applyEvent({
          _tag: "ConnectionCreated",
          actor: Actor.system,
          graphId: "graph",
          connection,
        });
      connect();
      expect(editor.store.nodeIO.graph?.break?.dataOutputs).toEqual([field]);
      expect(
        graphConnections(
          editor.store.project!.graphs.graph!,
          (id) => editor.store.nodeIO.graph?.[id],
        ),
      ).toHaveLength(1);
      const changedField = { ...field, type: DataType.Int };
      editor.applyEvent({
        _tag: "NodePropertyUpdated",
        actor: Actor.system,
        graphId: "graph",
        nodeId: "source",
        property: "type",
        properties: {},
        inputDefaults: {},
        deletedConnectionIds: [],
        io: { ...io, executionOutputs: [{ ...io.executionOutputs[0]!, scope: [changedField] }] },
      });
      expect(editor.store.nodeIO.graph?.break?.dataOutputs).toEqual([changedField]);
      editor.applyEvent({
        _tag: "ConnectionDeleted",
        actor: Actor.system,
        graphId: "graph",
        connectionId: "scope",
      });
      expect(editor.store.nodeIO.graph?.break?.dataOutputs).toEqual([]);
      connect();
      editor.applyEvent({
        _tag: "NodeDeleted",
        actor: Actor.system,
        graphId: "graph",
        nodeId: NodeId.make("source"),
        deletedConnectionIds: [connection.id],
      });
      expect(editor.store.nodeIO.graph?.break?.dataOutputs).toEqual([]);
      dispose();
    }));
});
