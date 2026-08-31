import { assert, describe, it } from "@effect/vitest";
import { ConnectionId, FunctionGraph, Graph, IoId, Project, Queue } from "@macrograph/core";
import { Effect, Fiber, Stream } from "effect";

import { ProjectQueues } from "../src/index.ts";

describe("ProjectQueues", () => {
  it.effect("invokes typed functions through a host scheduler and reloads queue definitions", () =>
    Effect.gen(function* () {
      const signature: Graph.FunctionSignature = {
        inputs: [{ id: "value", name: "Value", type: { _tag: "String" } }],
        outputs: [{ id: "result", name: "Result", type: { _tag: "String" } }],
      };
      const generated = FunctionGraph.generate(
        { ...Graph.empty("echo"), kind: "function", signature },
        () => crypto.randomUUID(),
      );
      const input = Object.values(generated.nodes).find((node) => node.schema.schema === "input")!;
      const output = Object.values(generated.nodes).find(
        (node) => node.schema.schema === "output",
      )!;
      const graph = {
        ...generated,
        connections: [
          ...generated.connections,
          {
            ...generated.connections[0]!,
            id: ConnectionId.make("value"),
            outNodeId: input.id,
            outIoId: IoId.make("gin:value"),
            inNodeId: output.id,
            inIoId: IoId.make("gout:result"),
          },
        ],
      };
      const project = {
        ...Project.empty(),
        graphs: { echo: graph },
        queues: { work: { id: Queue.QueueId.make("work"), name: "Work" } },
      };
      const runtime = yield* ProjectQueues.make(project);
      yield* runtime.queues.pause("work", true);
      const call = yield* runtime.queues
        .enqueue("work", "echo", { value: "captured" })
        .pipe(Effect.forkChild);
      yield* runtime.queues.changes.pipe(
        Stream.filter((states) => states[0]?.waiting.length === 1),
        Stream.runHead,
      );
      yield* runtime.queues.pause("work", false);
      assert.deepStrictEqual(yield* Fiber.join(call), { result: "captured" });
      assert.deepStrictEqual(yield* runtime.executor.invokeFunction("echo", { value: "direct" }), {
        result: "direct",
      });
      yield* runtime.executor.loadProject({ ...project, queues: {} });
      assert.deepStrictEqual(yield* runtime.queues.snapshot, []);
    }).pipe(Effect.scoped),
  );
});
