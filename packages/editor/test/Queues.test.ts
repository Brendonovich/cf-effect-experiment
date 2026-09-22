import { expect, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

it.effect("creates, renames, and deletes persisted queue definitions", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    const created = yield* editor.queue.create("Deliveries");
    expect((yield* editor.project.get()).queues[created.queue.id]?.name).toBe("Deliveries");
    yield* editor.queue.rename(created.queue.id, "Priority");
    expect((yield* editor.project.get()).queues[created.queue.id]?.name).toBe("Priority");
    yield* editor.queue.delete(created.queue.id);
    expect((yield* editor.project.get()).queues[created.queue.id]).toBeUndefined();
  }).pipe(
    Effect.provide(
      Editor.defaultLayer.pipe(
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);
