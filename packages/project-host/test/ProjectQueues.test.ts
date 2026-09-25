import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  Function as GraphFunction,
  GraphId,
  IoId,
  OutputRef,
  Project,
  Queue,
} from "@macrograph/core";
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

const identity = (id: string, type: DataType.Any = DataType.DateTime): GraphFunction.Model => ({
  canvas: {
    id: GraphId.make(id),
    name: id,
    nodes: {},
    connections: [
      connection(
        GraphFunction.InputBoundaryNodeId,
        "exec",
        GraphFunction.OutputBoundaryNodeId,
        "exec",
      ),
      connection(
        GraphFunction.InputBoundaryNodeId,
        "value",
        GraphFunction.OutputBoundaryNodeId,
        "result",
      ),
    ],
  },
  arguments: [{ id: IoId.make("value"), name: "Value", type }],
  returns: [{ id: IoId.make("result"), name: "Result", type }],
  inputPosition: { x: 0, y: 0 },
  outputPosition: { x: 400, y: 0 },
});

describe("ProjectQueues", () => {
  it.effect("resolves the queue's current function when dispatching", () =>
    Effect.gen(function* () {
      const echo = identity("echo");
      const text = identity("text", DataType.String);
      const project: Project.Model = {
        ...Project.empty(),
        functions: { echo, text },
        queues: {
          work: { id: Queue.QueueId.make("work"), name: "Work", functionId: "echo" },
        },
      };
      const runtime = yield* ProjectQueues.make(project);
      const value = DateTime.makeUnsafe("2026-08-31T12:00:00Z");
      yield* runtime.queues.pause("work", true);
      const pending = yield* runtime.queues
        .enqueue("work", { value: DateTime.formatIso(value) })
        .pipe(Effect.forkChild);
      yield* runtime.queues.changes.pipe(
        Stream.filter((states) => states[0]?.waiting.length === 1),
        Stream.runHead,
      );
      yield* runtime.executor.loadProject({
        ...project,
        queues: { work: { ...project.queues.work!, functionId: "text" } },
      });
      yield* runtime.queues.pause("work", false);
      const returned = (yield* Fiber.join(pending)).result;
      assert.strictEqual(returned, DateTime.formatIso(value));
      yield* runtime.executor.loadProject({ ...project, queues: {} });
      assert.deepStrictEqual(yield* runtime.queues.snapshot, []);
    }).pipe(Effect.scoped),
  );
});
