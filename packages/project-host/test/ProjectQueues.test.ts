import { assert, describe, it } from "@effect/vitest";
import { ConnectionId, Queue, GraphId, IoId, OutputRef, Project } from "@macrograph/core";
import { DataType } from "@macrograph/module";
import { DateTime, Effect, Fiber, Stream } from "effect";

import { ProjectQueues } from "../src/index.ts";

const connection = (outNodeId: string, outIo: string, inNodeId: string, inIoId: string) => ({
  id: ConnectionId.make(crypto.randomUUID()),
  outNodeId,
  outIo: OutputRef.port(outIo),
  inNodeId,
  inIoId: IoId.make(inIoId),
});

const identity = (id: string): Queue.Model => ({
  canvas: {
    id: GraphId.make(id),
    name: id,
    nodes: {},
    connections: [
      connection(Queue.InputBoundaryNodeId, "exec", Queue.OutputBoundaryNodeId, "exec"),
      connection(Queue.InputBoundaryNodeId, "value", Queue.OutputBoundaryNodeId, "result"),
    ],
  },
  arguments: [{ id: IoId.make("value"), name: "Value", type: DataType.DateTime }],
  returns: [{ id: IoId.make("result"), name: "Result", type: DataType.DateTime }],
  inputPosition: { x: 0, y: 0 },
  outputPosition: { x: 400, y: 0 },
});

describe("ProjectQueues", () => {
  it.effect("encodes captured values, invokes typed queue canvases, and reloads definitions", () =>
    Effect.gen(function* () {
      const echo = identity("echo");
      const project: Project.Model = {
        ...Project.empty(),
        queues: { echo },
      };
      const runtime = yield* ProjectQueues.make(project);
      const value = DateTime.makeUnsafe("2026-08-31T12:00:00Z");
      yield* runtime.queues.pause("echo", true);
      const pending = yield* runtime.queues
        .enqueue("echo", { value: DateTime.formatIso(value) })
        .pipe(Effect.forkChild);
      yield* runtime.queues.changes.pipe(
        Stream.filter((states) => states[0]?.waiting.length === 1),
        Stream.runHead,
      );
      yield* runtime.queues.pause("echo", false);
      const returned = (yield* Fiber.join(pending)).result;
      assert.isTrue(DateTime.isDateTime(returned));
      yield* runtime.executor.loadProject({ ...project, queues: {} });
      assert.deepStrictEqual(yield* runtime.queues.snapshot, []);
    }).pipe(Effect.scoped),
  );
});
