import { Actor, ConnectionId, IoId, NodeId, NodeIO, OutputRef, Project } from "@macrograph/core";
import { DataType as t } from "@macrograph/module/DataType";
import { Schema } from "effect";
import { createRoot } from "solid-js";
import { expect, it } from "vitest";

import { createEditorStore } from "../../src/editor/store";

const project = Schema.decodeUnknownSync(Project.Model)({
  ...Project.empty(),
  graphs: {
    graph: {
      id: "graph",
      name: "Graph",
      connections: [],
      nodes: Object.fromEntries(
        ["a", "b", "source"].map((id) => [
          id,
          {
            id,
            name: id,
            schema: { package: "test", schema: id },
            properties: {},
            inputDefaults: {},
            position: { x: 0, y: 0 },
            foldPins: false,
          },
        ]),
      ),
    },
  },
});
const io = (type: t.Any): NodeIO => ({
  dataInputs: [{ id: IoId.make("in"), type }],
  dataOutputs: [{ id: IoId.make("out"), type }],
  executionInputs: [],
  executionOutputs: [],
});

it("updates inferred IO on collaborative events, without feeding resolved types back into declarations", () =>
  createRoot((dispose) => {
    const editor = createEditorStore(),
      wildcard = t.Wildcard("T");
    editor.setProject(project, {
      graph: { a: io(wildcard), b: io(wildcard), source: io(t.String) },
    });
    const connect = (id: string, from: string, to: string) =>
      editor.applyEvent({
        _tag: "ConnectionCreated",
        actor: Actor.system,
        graphId: "graph",
        connection: {
          id: ConnectionId.make(id),
          outNodeId: from,
          outIo: OutputRef.port("out"),
          inNodeId: to,
          inIoId: IoId.make("in"),
        },
      });
    const type = (id: string) => editor.store.nodeIO.graph![id]!.dataOutputs[0]!.type;
    connect("bridge", "a", "b");
    connect("anchor", "source", "a");
    expect(type("b")).toEqual(t.String);
    expect(editor.store.declaredNodeIO.graph!.b!.dataOutputs[0]!.type).toEqual(wildcard);
    editor.applyEvent({
      _tag: "NodePropertyUpdated",
      actor: Actor.system,
      graphId: "graph",
      nodeId: "source",
      property: "type",
      properties: { type: "Int" },
      inputDefaults: {},
      deletedConnectionIds: [],
      io: io(t.Int),
    });
    expect(type("a")).toEqual(t.Int);
    expect(type("b")).toEqual(t.Int);
    editor.applyEvent({
      _tag: "ConnectionDeleted",
      actor: Actor.system,
      graphId: "graph",
      connectionId: "anchor",
    });
    expect(type("a")._tag).toBe("Wildcard");
    expect(type("b")._tag).toBe("Wildcard");
    connect("anchor", "source", "a");
    editor.applyEvent({
      _tag: "NodeDeleted",
      actor: Actor.system,
      graphId: "graph",
      nodeId: NodeId.make("a"),
      deletedConnectionIds: [ConnectionId.make("anchor"), ConnectionId.make("bridge")],
    });
    expect(type("b")._tag).toBe("Wildcard");
    expect(editor.store.nodeIO.graph!.a).toBeUndefined();
    editor.setProject(project, { graph: { a: io(wildcard), b: io(wildcard), source: io(t.Bool) } });
    expect(type("b")).toEqual(wildcard);
    dispose();
  }));

it("never renders stale inference for invalid authoritative IO and recovers after repair", () =>
  createRoot((dispose) => {
    const editor = createEditorStore(),
      wildcard = t.Wildcard("T");
    const anchor = {
      id: ConnectionId.make("anchor"),
      outNodeId: "source",
      outIo: OutputRef.port("out"),
      inNodeId: "a",
      inIoId: IoId.make("in"),
    };
    const downstream = {
      id: ConnectionId.make("downstream"),
      outNodeId: "a",
      outIo: OutputRef.port("out"),
      inNodeId: "b",
      inIoId: IoId.make("in"),
    };
    editor.setProject(
      {
        ...project,
        graphs: { graph: { ...project.graphs.graph!, connections: [anchor, downstream] } },
      },
      {
        graph: { a: io(wildcard), b: io(t.String), source: io(t.String) },
      },
    );
    const type = () => editor.store.nodeIO.graph!.a!.dataOutputs[0]!.type;
    expect(type()).toEqual(t.String);
    editor.applyEvent({
      _tag: "NodePropertyUpdated",
      actor: Actor.system,
      graphId: "graph",
      nodeId: "source",
      property: "type",
      properties: { type: "Int" },
      inputDefaults: {},
      deletedConnectionIds: [],
      io: io(t.Int),
    });
    expect(type()).toEqual(wildcard);
    editor.applyEvent({
      _tag: "ConnectionDeleted",
      actor: Actor.system,
      graphId: "graph",
      connectionId: downstream.id,
    });
    expect(type()).toEqual(t.Int);
    dispose();
  }));
