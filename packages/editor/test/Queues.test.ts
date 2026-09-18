import { expect, it } from "@effect/vitest";
import { FunctionGraph, Project, SchemaId } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

it.effect("authors Add to Queue with typed function pins and rejects missing queue targets", () =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    yield* persistence.saveProject(Project.empty());
    const editor = yield* Editor.Service;
    const queue = yield* editor.queue.create("Deliveries");
    const fn = yield* editor.graph.create({
      kind: "function",
      signature: {
        inputs: [{ id: "message", name: "Message", type: { _tag: "String" } }],
        outputs: [{ id: "delivered", name: "Delivered", type: { _tag: "Bool" } }],
      },
    });
    const graph = yield* editor.graph.create({});
    const node = yield* editor.node.create({
      graphID: graph.graph.id,
      node: {
        schema: { package: FunctionGraph.queuePackageId, schema: SchemaId.make("add") },
        properties: { queue: queue.queue.id, function: fn.graph.id },
        inputDefaults: { "in:message": "hello" },
      },
    });
    expect(node.io.dataInputs[0]).toMatchObject({
      id: "in:message",
      name: "Message",
      type: { _tag: "String" },
    });
    expect(node.io.dataOutputs[0]).toMatchObject({ id: "out:delivered", type: { _tag: "Bool" } });
    expect((yield* editor.project.snapshot()).nodeIO[graph.graph.id]?.[node.node.id]).toEqual(
      node.io,
    );
    expect(
      (yield* editor.node
        .setProperty({
          graphID: graph.graph.id,
          nodeID: node.node.id,
          property: "queue",
          value: "missing",
        })
        .pipe(Effect.result))._tag,
    ).toBe("Failure");
    const renamed = yield* editor.graph.setSignature(fn.graph.id, {
      inputs: [{ id: "message", name: "Notification", type: { _tag: "String" } }],
      outputs: fn.graph.signature!.outputs,
    });
    expect(renamed.nodeIO[graph.graph.id]?.[node.node.id]?.dataInputs[0]?.name).toBe(
      "Notification",
    );
    expect((yield* editor.graph.delete({ graphID: fn.graph.id }).pipe(Effect.result))._tag).toBe(
      "Failure",
    );
    yield* editor.queue.delete(queue.queue.id);
    expect(
      (yield* editor.project.get()).graphs[graph.graph.id]?.nodes[node.node.id]?.properties.queue,
    ).toBe(queue.queue.id);
  }).pipe(
    Effect.provide(
      Editor.defaultLayer.pipe(
        Layer.provideMerge(Packages.defaultLayer),
        Layer.provideMerge(Persistence.layerMemory),
      ),
    ),
  ),
);
