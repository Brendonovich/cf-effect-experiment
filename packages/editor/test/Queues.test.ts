import { expect, it } from "@effect/vitest";
import { IoId, PackageId, Project, Queue, SchemaId } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Exit, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

it.effect("creates, renames, and deletes persisted queue definitions", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    yield* (yield* Packages.Service).loadPackage(Queue.packageModel);
    const created = yield* editor.queue.create("Deliveries");
    const id = created.queue.canvas.id;
    expect((yield* editor.project.get()).queues[id]?.canvas.name).toBe("Deliveries");
    yield* editor.queue.rename(id, "Priority");
    expect((yield* editor.project.get()).queues[id]?.canvas.name).toBe("Priority");
    yield* editor.queue.delete(id);
    expect((yield* editor.project.get()).queues[id]).toBeUndefined();
  }).pipe(
    Effect.provide(
      Editor.defaultLayer.pipe(
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);

it.effect("edits queue signatures and rejects direct and transitive enqueue recursion", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    yield* (yield* Packages.Service).loadPackage(Queue.packageModel);
    const first = (yield* editor.queue.create("First")).queue.canvas.id;
    const second = (yield* editor.queue.create("Second")).queue.canvas.id;
    yield* editor.queue.addField(first, "input");
    expect((yield* editor.project.get()).queues[first]?.arguments).toHaveLength(1);
    const node = (queue: string) => ({
      schema: { package: Queue.packageId, schema: Queue.EnqueueSchemaId },
      properties: { queue },
      position: { x: 0, y: 0 },
    });
    const enqueue = yield* editor.node.create({ graphID: second, node: node(first) });
    expect(enqueue.io.dataInputs.map((input) => input.id)).toEqual([
      (yield* editor.project.get()).queues[first]!.arguments[0]!.id,
    ]);
    const transitive = yield* editor.node
      .create({ graphID: first, node: node(second) })
      .pipe(Effect.exit);
    expect(Exit.isFailure(transitive)).toBe(true);
    const direct = yield* editor.node
      .create({ graphID: first, node: node(first) })
      .pipe(Effect.exit);
    expect(Exit.isFailure(direct)).toBe(true);
  }).pipe(
    Effect.provide(
      Editor.defaultLayer.pipe(
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);

it.effect("rejects event nodes on queue canvases", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    const packages = yield* Packages.Service;
    const packageId = PackageId.make("queue-test");
    const schemaId = SchemaId.make("event");
    yield* packages.loadPackage({
      id: packageId,
      name: "Queue test",
      resources: [],
      schemas: [
        {
          id: schemaId,
          name: "Event",
          type: "event",
          properties: [],
          executionInputs: [],
          executionOutputs: [{ id: IoId.make("exec") }],
          dataInputs: [],
          dataOutputs: [],
        },
      ],
    });
    const queueId = (yield* editor.queue.create("Queue")).queue.canvas.id;
    const result = yield* editor.node
      .create({
        graphID: queueId,
        node: {
          schema: { package: packageId, schema: schemaId },
          properties: {},
          position: { x: 0, y: 0 },
        },
      })
      .pipe(Effect.exit);
    expect(Exit.isFailure(result)).toBe(true);
  }).pipe(
    Effect.provide(
      Editor.defaultLayer.pipe(
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);
