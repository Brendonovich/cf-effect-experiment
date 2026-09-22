import { expect, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Queue } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Exit, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

it.effect("creates, renames, and deletes persisted queue definitions", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    const fn = yield* editor.function.create("Worker");
    const created = yield* editor.queue.create("Deliveries", fn.fn.canvas.id);
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

it.effect("rejects direct and transitive queue dependency cycles", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    yield* (yield* Packages.Service).loadPackage(Queue.packageModel);
    const firstFunction = (yield* editor.function.create("First worker")).fn.canvas.id;
    const secondFunction = (yield* editor.function.create("Second worker")).fn.canvas.id;
    const first = (yield* editor.queue.create("First", firstFunction)).queue.id;
    const second = (yield* editor.queue.create("Second", secondFunction)).queue.id;
    const node = (queue: string) => ({
      schema: { package: Queue.packageId, schema: Queue.EnqueueSchemaId },
      properties: { queue },
      position: { x: 0, y: 0 },
    });

    yield* editor.node.create({ graphID: secondFunction, node: node(first) });
    expect(
      Exit.isFailure(
        yield* editor.node.create({ graphID: firstFunction, node: node(second) }).pipe(Effect.exit),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        yield* editor.node.create({ graphID: firstFunction, node: node(first) }).pipe(Effect.exit),
      ),
    ).toBe(true);
  }).pipe(
    Effect.provide(
      Editor.defaultLayer.pipe(
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);
