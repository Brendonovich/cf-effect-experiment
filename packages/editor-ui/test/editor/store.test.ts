import {
  Actor,
  CustomTypes,
  Project,
  Graph,
  NodeId,
  PackageId,
  SchemaId,
  IoId,
  ConnectionId,
} from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEditorStore, resourceValuesKey } from "../../src/editor/store";

describe("editor store", () => {
  it("updates definitions, generated catalog and current IO without discarding invalid graph data", () => {
    createRoot((dispose) => {
      const editor = createEditorStore();
      const id = DataType.DefinitionId.make("person");
      const types: DataType.Definitions = {
        person: { _tag: "Struct", id, name: "Person", fields: [] },
      };
      const node = {
        id: NodeId.make("node"),
        name: "Make Person",
        schema: {
          package: PackageId.make("CustomTypes"),
          schema: SchemaId.make(JSON.stringify([id, "make"])),
        },
        position: { x: 0, y: 0 },
        properties: {},
        inputDefaults: { old: "kept" },
        foldPins: false,
      };
      const connection = {
        id: ConnectionId.make("wire"),
        outNodeId: "node",
        outIoId: IoId.make("value"),
        inNodeId: "node",
        inIoId: IoId.make("old"),
      };
      const graph = { ...Graph.empty("graph"), nodes: { node }, connections: [connection] };
      editor.setProject({ ...Project.empty(), types, graphs: { graph } }, {});
      editor.setPackages([]);
      expect(
        editor.store.packages.find((pkg) => pkg.id === CustomTypes.packageId)?.schemas.length,
      ).toBeGreaterThan(0);
      const emptyIO = {
        dataInputs: [],
        dataOutputs: [],
        executionInputs: [],
        executionOutputs: [],
      };
      editor.applyEvent({
        _tag: "TypeDefinitionsUpdated",
        actor: Actor.system,
        types: {},
        nodeIO: { graph: { node: emptyIO } },
        deletedConnectionIds: { graph: ["wire"] },
      });
      expect(editor.store.project?.types).toEqual({});
      expect(editor.store.nodeIO.graph?.node).toEqual(emptyIO);
      expect(editor.store.project?.graphs.graph?.nodes.node?.inputDefaults).toEqual({
        old: "kept",
      });
      expect(editor.store.project?.graphs.graph?.connections).toEqual([]);
      expect(
        editor.store.packages.find((pkg) => pkg.id === CustomTypes.packageId)?.schemas,
      ).toEqual([]);
      dispose();
    });
  });
  it("retains resource values received before the project snapshot", () => {
    createRoot((dispose) => {
      const { store, applyEvent, setProject } = createEditorStore();

      applyEvent({
        _tag: "ResourceValuesUpdated",
        actor: Actor.system,
        package: "twitch",
        resource: "account",
        values: [{ id: "account-1", display: "Streamer" }],
      });

      expect(store.resourceValues[resourceValuesKey("twitch", "account")]).toEqual([
        { id: "account-1", display: "Streamer" },
      ]);
      setProject(Project.empty(), {});
      expect(store.project?.name).toBe("New Project");
      expect(store.resourceValues[resourceValuesKey("twitch", "account")]).toHaveLength(1);
      dispose();
    });
  });
});
