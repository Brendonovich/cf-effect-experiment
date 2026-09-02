import { Actor, PackageId, Project, ResourceConstant } from "@macrograph/core";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEditorStore, resourceValuesKey } from "../../src/editor/store";

describe("editor store", () => {
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
