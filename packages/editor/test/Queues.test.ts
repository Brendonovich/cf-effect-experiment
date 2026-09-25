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

it.effect("rejects direct and transitive queue dependency cycles", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    yield* (yield* Packages.Service).loadPackage(Queue.packageModel);
    const firstFunction = (yield* editor.function.create("First worker")).fn.canvas.id;
    const secondFunction = (yield* editor.function.create("Second worker")).fn.canvas.id;
    const first = (yield* editor.queue.create("First")).queue.id;
    const second = (yield* editor.queue.create("Second")).queue.id;
    const node = (queue: string, fn: string) => ({
      schema: { package: Queue.packageId, schema: Queue.EnqueueSchemaId },
      properties: { queue, function: fn },
      position: { x: 0, y: 0 },
    });

    yield* editor.node.create({ graphID: secondFunction, node: node(first, firstFunction) });
    expect(
      Exit.isFailure(
        yield* editor.node
          .create({ graphID: firstFunction, node: node(second, secondFunction) })
          .pipe(Effect.exit),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        yield* editor.node
          .create({ graphID: firstFunction, node: node(first, firstFunction) })
          .pipe(Effect.exit),
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

it.effect("derives Add to Queue pins from its function instead of its queue", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    yield* (yield* Packages.Service).loadPackage(Queue.packageModel);
    const createdFunction = yield* editor.function.create("Worker");
    const input = yield* editor.function.addField(createdFunction.graph.id, "input");
    const output = yield* editor.function.addField(createdFunction.graph.id, "output");
    const queue = (yield* editor.queue.create("Work")).queue;
    const graph = yield* editor.graph.create({ name: "Caller" });
    const node = yield* editor.node.create({
      graphID: graph.graph.id,
      node: { schema: { package: Queue.packageId, schema: Queue.EnqueueSchemaId } },
    });
    expect(node.io).toEqual(Queue.enqueueIO(undefined));

    const selectedQueue = yield* editor.node.setProperty({
      graphID: graph.graph.id,
      nodeID: node.node.id,
      property: "queue",
      value: queue.id,
    });
    expect(selectedQueue.io).toEqual(Queue.enqueueIO(undefined));

    const selectedFunction = yield* editor.node.setProperty({
      graphID: graph.graph.id,
      nodeID: node.node.id,
      property: "function",
      value: createdFunction.graph.id,
    });
    expect(selectedFunction.io).toEqual(
      Queue.enqueueIO({ ...output.fn, arguments: input.fn.arguments }),
    );
  }).pipe(
    Effect.provide(
      Editor.defaultLayer.pipe(
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);
