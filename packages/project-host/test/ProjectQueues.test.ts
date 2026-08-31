import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  FunctionGraph,
  Graph,
  IoId,
  Node,
  NodeId,
  Project,
  Queue,
  SchemaId,
} from "@macrograph/core";
import { DateTime, Effect, Fiber, Stream } from "effect";

import { ProjectQueues } from "../src/index.ts";

describe("ProjectQueues", () => {
  it.effect("Add to Queue awaits typed DateTime results and rejects queue cycles", () =>
    Effect.gen(function* () {
      const signature: Graph.FunctionSignature = {
        inputs: [{ id: "value", name: "Value", type: { _tag: "DateTime" } }],
        outputs: [{ id: "result", name: "Result", type: { _tag: "DateTime" } }],
      };
      const echo = FunctionGraph.generate(
        { ...Graph.empty("echo"), kind: "function", signature },
        () => crypto.randomUUID(),
      );
      const input = Object.values(echo.nodes).find((node) => node.schema.schema === "input")!;
      const output = Object.values(echo.nodes).find((node) => node.schema.schema === "output")!;
      const identity = {
        ...echo,
        connections: [
          ...echo.connections,
          {
            id: ConnectionId.make("data"),
            outNodeId: input.id,
            outIoId: IoId.make("gin:value"),
            inNodeId: output.id,
            inIoId: IoId.make("gout:result"),
          },
        ],
      };
      const call: Node.Model = {
        id: NodeId.make("enqueue"),
        name: "Add to Queue",
        schema: { package: FunctionGraph.queuePackageId, schema: SchemaId.make("add") },
        properties: { queue: "work", function: "echo" },
        inputDefaults: {},
        foldPins: false,
        position: { x: 200, y: 0 },
      };
      const outer: Graph.Model = {
        ...identity,
        id: Graph.GraphId.make("outer"),
        nodes: { ...identity.nodes, enqueue: call },
        connections: [
          {
            id: ConnectionId.make("start"),
            outNodeId: input.id,
            outIoId: IoId.make("exec"),
            inNodeId: call.id,
            inIoId: IoId.make("exec"),
          },
          {
            id: ConnectionId.make("end"),
            outNodeId: call.id,
            outIoId: IoId.make("exec"),
            inNodeId: output.id,
            inIoId: IoId.make("exec"),
          },
          {
            id: ConnectionId.make("arg"),
            outNodeId: input.id,
            outIoId: IoId.make("gin:value"),
            inNodeId: call.id,
            inIoId: IoId.make("in:value"),
          },
          {
            id: ConnectionId.make("return"),
            outNodeId: call.id,
            outIoId: IoId.make("out:result"),
            inNodeId: output.id,
            inIoId: IoId.make("gout:result"),
          },
        ],
      };
      const runtime = yield* ProjectQueues.make({
        ...Project.empty(),
        graphs: { echo: identity, outer },
        queues: { work: { id: Queue.QueueId.make("work"), name: "Work" } },
      });
      const value = DateTime.makeUnsafe("2026-08-31T12:00:00Z");
      yield* runtime.queues.pause("work", true);
      const pending = yield* runtime.executor
        .invokeFunction("outer", { value })
        .pipe(Effect.forkChild);
      yield* runtime.queues.changes.pipe(
        Stream.filter((states) => states[0]?.waiting.length === 1),
        Stream.runHead,
      );
      yield* runtime.queues.pause("work", false);
      const returned = (yield* Fiber.join(pending)).result;
      assert.isTrue(DateTime.isDateTime(returned));
      if (DateTime.isDateTime(returned))
        assert.strictEqual(DateTime.formatIso(returned), DateTime.formatIso(value));
      assert.strictEqual(
        (yield* runtime.executor
          .invokeFunction("outer", { value }, { queueLineage: ["work"] })
          .pipe(Effect.result))._tag,
        "Failure",
      );
    }).pipe(Effect.scoped),
  );
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
