import { Actor, Project, Queue } from "@macrograph/core";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEditorStore, resourceValuesKey } from "../../src/editor/store";

describe("editor store", () => {
  it("projects queue metadata updates and deletion without modifying the source snapshot", () => {
    createRoot((dispose) => {
      const editor = createEditorStore();
      const project = Project.empty();
      editor.setProject(project, {});
      const queue = { id: Queue.QueueId.make("work"), name: "Work" };
      editor.applyEvent({ _tag: "QueueUpdated", actor: Actor.system, queue });
      expect(editor.store.project?.queues.work).toEqual(queue);
      expect(project.queues).toEqual({});
      editor.applyEvent({ _tag: "QueueDeleted", actor: Actor.system, queueId: "work" });
      expect(editor.store.project?.queues).toEqual({});
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
