import {
  Actor,
  ConnectionId,
  CustomTypes,
  IoId,
  NodeIO,
  OutputRef,
  Project,
} from "@macrograph/core";
import { DataType as t } from "@macrograph/module";
import { Schema } from "effect";
import { createRoot } from "solid-js";
import { expect, it } from "vitest";

import { compatibleSchemaPorts } from "../../src/editor/graph/connectionAuthoring";
import { createEditorStore } from "../../src/editor/store";

it("offers Break Struct for struct or unresolved wildcard sources, not primitives, containers or enums", () => {
  const item = t.DefinitionId.make("item"),
    choice = t.DefinitionId.make("choice");
  const definitions: t.Definitions = {
    item: { _tag: "Struct", id: item, name: "Item", fields: [] },
    choice: { _tag: "Enum", id: choice, name: "Choice", variants: [{ name: "Empty", fields: [] }] },
  };
  const schema = CustomTypes.packageModel.schemas.find((schema) => schema.id === "BreakStruct")!;
  for (const type of [t.String, t.Int, t.List(t.Custom(item)), t.Custom(choice)])
    expect(
      compatibleSchemaPorts(
        schema,
        { direction: "output", port: { kind: "data", id: "out", type } },
        CustomTypes.packageId,
        definitions,
      ),
    ).toEqual([]);
  for (const type of [t.Custom(item), t.Wildcard("T")])
    expect(
      compatibleSchemaPorts(
        schema,
        { direction: "output", port: { kind: "data", id: "out", type } },
        CustomTypes.packageId,
        definitions,
      ),
    ).toHaveLength(1);
});

it("derives Break fields on snapshot/events and clears stale fields when its anchor disappears", () =>
  createRoot((dispose) => {
    const id = t.DefinitionId.make("item");
    const project = Schema.decodeUnknownSync(Project.Model)({
      ...Project.empty(),
      types: {
        item: { _tag: "Struct", id, name: "Item", fields: [{ name: "text", type: t.String }] },
      },
      graphs: {
        graph: {
          id: "graph",
          name: "Graph",
          connections: [],
          nodes: Object.fromEntries(
            [
              ["source", "test", "source"],
              ["break", CustomTypes.packageId, "BreakStruct"],
            ].map(([id, pkg, schema]) => [
              id,
              {
                id,
                name: id,
                schema: { package: pkg, schema },
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
    const source: NodeIO = {
      dataInputs: [],
      dataOutputs: [{ id: IoId.make("value"), type: t.Custom(id) }],
      executionInputs: [],
      executionOutputs: [],
    };
    const node = project.graphs.graph!.nodes.break!;
    const editor = createEditorStore();
    editor.setProject(project, {
      graph: { source, break: CustomTypes.nodeIO(node.schema, {}, project.types)! },
    });
    const output = () => editor.store.nodeIO.graph!.break!.dataOutputs;
    expect(output()).toEqual([]);
    const connection = {
      id: ConnectionId.make("anchor"),
      outNodeId: "source",
      outIo: OutputRef.port("value"),
      inNodeId: "break",
      inIoId: IoId.make("value"),
    };
    editor.applyEvent({
      _tag: "ConnectionCreated",
      actor: Actor.system,
      graphId: "graph",
      connection,
    });
    expect(output()).toEqual([{ id: 'field:"text"', name: "text", type: t.String }]);
    const snapshot = {
      ...project,
      graphs: { graph: { ...project.graphs.graph!, connections: [connection] } },
    };
    editor.setProject(snapshot, {
      graph: {
        source,
        break: { ...CustomTypes.nodeIO(node.schema, {}, project.types)!, dataOutputs: output() },
      },
    });
    editor.applyEvent({
      _tag: "ConnectionDeleted",
      actor: Actor.system,
      graphId: "graph",
      connectionId: connection.id,
    });
    expect(output()).toEqual([]);
    // Snapshots carry wildcard input declarations; verify ordinary declaration reload too.
    editor.setProject(snapshot, {
      graph: { source, break: CustomTypes.nodeIO(node.schema, {}, project.types)! },
    });
    expect(output()[0]!.type).toEqual(t.String);
    dispose();
  }));
