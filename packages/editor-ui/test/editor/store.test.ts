import { Actor, CustomEvent, Project } from "@macrograph/core";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEditorStore, resourceValuesKey } from "../../src/editor/store";

describe("editor store", () => {
  it("projects collaborative registry updates into the node creation catalog", () =>
    createRoot((dispose) => {
      const editor = createEditorStore();
      editor.setProject(Project.empty(), {});
      const customEvents = {
        event: {
          id: "event",
          name: "Renamed",
          fields: [{ id: "field", name: "Text", type: { _tag: "String" as const } }],
        },
      };
      editor.applyEvent({
        _tag: "CustomEventsChanged",
        actor: { type: "CLIENT", id: "other" },
        customEvents,
        graphs: {},
        nodeIO: {},
        pkg: CustomEvent.packageModel(customEvents),
      });
      expect(editor.store.project?.customEvents).toEqual(customEvents);
      expect(editor.store.packages[0]?.schemas.map((schema) => schema.id)).toEqual([
        "emit:event",
        "on:event",
      ]);
      dispose();
    }));
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
