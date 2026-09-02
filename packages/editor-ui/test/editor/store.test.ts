import {
  Actor,
  ConnectionId,
  CustomTypes,
  Graph,
  IoId,
  NodeId,
  PackageId,
  Project,
  ResourceConstant,
  SchemaId,
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

  it("switches resource defaults without changing other types", () => {
    createRoot((dispose) => {
      const { store, applyEvent, setProject } = createEditorStore();
      const resource = { package: PackageId.make("test"), resource: "account" };
      const first = ResourceConstant.Model.make({
        id: ResourceConstant.Id.make("first"),
        name: "First",
        resource,
        isDefault: true,
      });
      const second = ResourceConstant.Model.make({
        id: ResourceConstant.Id.make("second"),
        name: "Second",
        resource,
      });
      const other = ResourceConstant.Model.make({
        id: ResourceConstant.Id.make("other"),
        name: "Other",
        resource: { ...resource, resource: "connection" },
        isDefault: true,
      });
      setProject(
        Project.Model.make({
          ...Project.empty(),
          constants: { first, second, other },
        }),
        {},
      );
      applyEvent({
        _tag: "ResourceConstantDefaultChanged",
        actor: Actor.system,
        constants: [
          { ...first, isDefault: false },
          { ...second, isDefault: true },
        ],
      });
      expect(store.project?.constants.first?.isDefault).toBe(false);
      expect(store.project?.constants.second?.isDefault).toBe(true);
      expect(store.project?.constants.other?.isDefault).toBe(true);
      applyEvent({ _tag: "ResourceConstantDeleted", actor: Actor.system, constantId: second.id });
      expect(store.project?.constants.second).toBeUndefined();
      expect(ResourceConstant.getDefault(store.project!.constants, resource)?.id).toBe(first.id);
      applyEvent({ _tag: "ResourceConstantDeleted", actor: Actor.system, constantId: first.id });
      expect(ResourceConstant.getDefault(store.project!.constants, resource)).toBeUndefined();
      expect(ResourceConstant.getDefault(store.project!.constants, other.resource)?.id).toBe(
        other.id,
      );
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
