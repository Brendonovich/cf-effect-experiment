import { describe, expect, it } from "@effect/vitest";
import {
  ConnectionId,
  FunctionGraph,
  Graph,
  IoId,
  Node,
  NodeId,
  PackageId,
  Project,
  Queue,
  RenderedProject,
  SchemaId,
} from "@macrograph/core";
import { DataType, Plugin } from "@macrograph/plugin";
import { Effect, Result, Schema } from "effect";

import { Executor } from "../src/Executor.ts";

const signature: Graph.FunctionSignature = {
  inputs: [{ id: "value", name: "Value", type: DataType.String }],
  outputs: [{ id: "result", name: "Result", type: DataType.String }],
};
const connection = (outNodeId: string, outIoId: string, inNodeId: string, inIoId: string) => ({
  id: ConnectionId.make(crypto.randomUUID()),
  outNodeId,
  outIoId: IoId.make(outIoId),
  inNodeId,
  inIoId: IoId.make(inIoId),
});
const identity = (id: string): Graph.Model => {
  const graph = FunctionGraph.generate({ ...Graph.empty(id), kind: "function", signature }, () =>
    crypto.randomUUID(),
  );
  const input = Object.values(graph.nodes).find((node) => node.schema.schema === "input")!;
  const output = Object.values(graph.nodes).find((node) => node.schema.schema === "output")!;
  return {
    ...graph,
    connections: [
      ...graph.connections,
      connection(input.id, "gin:value", output.id, "gout:result"),
    ],
  };
};
const nested = (id: string, target: string): Graph.Model => {
  const graph = identity(id);
  const input = Object.values(graph.nodes).find((node) => node.schema.schema === "input")!;
  const output = Object.values(graph.nodes).find((node) => node.schema.schema === "output")!;
  const call: Node.Model = {
    id: NodeId.make("call"),
    name: "Call",
    schema: { package: FunctionGraph.packageId, schema: SchemaId.make("call") },
    properties: { function: target },
    inputDefaults: {},
    foldPins: false,
    position: { x: 200, y: 0 },
  };
  return {
    ...graph,
    nodes: { ...graph.nodes, call },
    connections: [
      connection(input.id, "exec", call.id, "exec"),
      connection(call.id, "exec", output.id, "exec"),
      connection(input.id, "gin:value", call.id, "in:value"),
      connection(call.id, "out:result", output.id, "gout:result"),
    ],
  };
};
const project = (...graphs: Graph.Model[]): Project.Model => ({
  ...Project.empty(),
  graphs: Object.fromEntries(graphs.map((graph) => [graph.id, graph])),
});

describe("Function invocation", () => {
  it.effect(
    "passes inherited queue lineage and invocation path to the inline orchestration hook",
    () =>
      Effect.gen(function* () {
        const outer = nested("outer", "leaf");
        const call = outer.nodes.call!;
        let captured: Executor.QueueInvocation | undefined;
        const executor = yield* Executor.make(
          {
            ...project(identity("leaf"), {
              ...outer,
              nodes: {
                ...outer.nodes,
                call: {
                  ...call,
                  schema: { package: FunctionGraph.queuePackageId, schema: SchemaId.make("add") },
                  properties: { ...call.properties, queue: "queue" },
                },
              },
            }),
            queues: { queue: { id: Queue.QueueId.make("queue"), name: "Queue" } },
          },
          {
            queueInvocation: (invocation) =>
              Effect.sync(() => {
                captured = invocation;
                return { result: invocation.inputs.value };
              }),
          },
        );
        expect(
          yield* executor.invokeFunction(
            "outer",
            { value: "queued" },
            {
              executionPath: "queue-job:stable",
              queueLineage: ["parent"],
              executionTraceId: "trace",
              eventNodeId: "root",
            },
          ),
        ).toEqual({ result: "queued" });
        expect(captured?.queueLineage).toEqual(["parent"]);
        expect(captured?.key.executionPath.startsWith("queue-job:stable")).toBe(true);
        expect(captured?.key.eventNodeId).toBe("root");
        expect(captured?.key.executionTraceId).toBe("trace");
      }),
  );
  it.effect("replays invocation-scoped durable steps inline without nested tasks", () =>
    Effect.gen(function* () {
      const leaf = identity("leaf");
      const input = Object.values(leaf.nodes).find((node) => node.schema.schema === "input")!;
      const output = Object.values(leaf.nodes).find((node) => node.schema.schema === "output")!;
      const action: Node.Model = {
        ...input,
        id: NodeId.make("action"),
        schema: { package: PackageId.make("action"), schema: SchemaId.make("action") },
      };
      const durableLeaf = {
        ...leaf,
        nodes: { ...leaf.nodes, action },
        connections: [
          connection(input.id, "exec", action.id, "exec"),
          connection(action.id, "exec", output.id, "exec"),
          connection(input.id, "gin:value", action.id, "value"),
          connection(action.id, "result", output.id, "gout:result"),
        ],
      };
      const outer = nested("outer", "leaf");
      const outerInput = Object.values(outer.nodes).find((node) => node.schema.schema === "input")!;
      const outerOutput = Object.values(outer.nodes).find(
        (node) => node.schema.schema === "output",
      )!;
      const second: Node.Model = {
        ...outer.nodes.call!,
        id: NodeId.make("second"),
        inputDefaults: { "in:value": "second" },
      };
      const snapshot = project(durableLeaf, {
        ...outer,
        nodes: { ...outer.nodes, second },
        connections: [
          connection(outerInput.id, "exec", "call", "exec"),
          connection("call", "exec", "second", "exec"),
          connection("second", "exec", outerOutput.id, "exec"),
          connection(outerInput.id, "gin:value", "call", "in:value"),
          connection("second", "out:result", outerOutput.id, "gout:result"),
        ],
      });
      let runs = 0;
      let insideTask = false;
      const cached = new Map<string, Executor.NodeExecutionResult>();
      const paths: string[] = [];
      const driver: Executor.ExecutionDriver = {
        executeNode: (key, effect) =>
          Effect.gen(function* () {
            expect(insideTask).toBe(false);
            const id = `${key.graphId}/${key.eventNodeId}/${key.executionPath}/${key.nodeId}`;
            paths.push(id);
            const previous = cached.get(id);
            if (previous) return previous;
            insideTask = true;
            const result = yield* effect.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  insideTask = false;
                }),
              ),
            );
            cached.set(id, result);
            return result;
          }),
      };
      const plugin = Plugin.make({
        id: "action",
        effect: (context) =>
          context.schema.register({
            id: "action",
            io: (io) => ({
              value: io.data.in("value", DataType.String),
              result: io.data.out("result", DataType.String),
            }),
            run: ({ io }) =>
              Effect.sync(() => {
                runs++;
                io.result(io.value);
              }),
          }),
      });
      for (let replay = 0; replay < 2; replay++) {
        const executor = yield* Executor.make(snapshot, { executionDriver: driver });
        yield* executor.plugin(plugin);
        expect(yield* executor.invokeFunction("outer", { value: "first" })).toEqual({
          result: "second",
        });
      }
      expect(runs).toBe(2);
      expect(cached.size).toBe(2);
      expect(paths.slice(0, 2)).toEqual(paths.slice(2));
      expect(paths[0]).not.toBe(paths[1]);
      const rendered = {
        ...snapshot,
        graphs: Object.fromEntries(
          Object.values(snapshot.graphs).map((graph) => [
            graph.id,
            {
              ...graph,
              schemas: {},
              nodes: Object.fromEntries(
                Object.values(graph.nodes).map((node) => [
                  node.id,
                  { ...node, io: FunctionGraph.io(node.schema.schema, graph.signature) },
                ]),
              ),
            },
          ]),
        ),
      };
      const encoded = Schema.encodeUnknownSync(RenderedProject.Model)(rendered);
      expect(Schema.decodeUnknownSync(Project.Model)(encoded).graphs.leaf?.signature).toEqual(
        signature,
      );
    }),
  );
  it.effect("isolates concurrent and nested frames even with identical call-node IDs", () =>
    Effect.gen(function* () {
      const executor = yield* Executor.make(
        project(identity("leaf"), nested("middle", "leaf"), nested("outer", "middle")),
      );
      const results = yield* Effect.forEach(
        ["first", "second", "third"],
        (value) => executor.invokeFunction("outer", { value }),
        { concurrency: "unbounded" },
      );
      expect(results).toEqual([{ result: "first" }, { result: "second" }, { result: "third" }]);
    }),
  );
  it.effect("awaits asynchronous nodes before resolving results", () =>
    Effect.gen(function* () {
      const graph = identity("async");
      const input = Object.values(graph.nodes).find((node) => node.schema.schema === "input")!;
      const output = Object.values(graph.nodes).find((node) => node.schema.schema === "output")!;
      const node: Node.Model = {
        ...input,
        id: NodeId.make("async"),
        schema: { package: PackageId.make("async"), schema: SchemaId.make("wait") },
      };
      const plugin = Plugin.make({
        id: "async",
        effect: (context) =>
          context.schema.register({
            id: "wait",
            io: (io) => ({
              input: io.data.in("value", DataType.String),
              output: io.data.out("result", DataType.String),
              exec: io.exec.out("exec"),
            }),
            run: ({ io }) =>
              Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => io.output(`${io.input}!`)))),
          }),
      });
      const executor = yield* Executor.make(
        project({
          ...graph,
          nodes: { ...graph.nodes, async: node },
          connections: [
            connection(input.id, "exec", node.id, "exec"),
            connection(node.id, "exec", output.id, "exec"),
            connection(input.id, "gin:value", node.id, "value"),
            connection(node.id, "result", output.id, "gout:result"),
          ],
        }),
      );
      yield* executor.plugin(plugin);
      expect(yield* executor.invokeFunction("async", { value: "awaited" })).toEqual({
        result: "awaited!",
      });
    }),
  );
  it.effect("fails missing results, targets, malformed boundaries, and recursion explicitly", () =>
    Effect.gen(function* () {
      const graph = identity("missing");
      const executor = yield* Executor.make(
        project(
          {
            ...graph,
            connections: graph.connections.filter((connection) => connection.outIoId === "exec"),
          },
          nested("recursive", "recursive"),
          { ...identity("malformed"), nodes: {} },
        ),
      );
      for (const [id, tag] of [
        ["missing", "MissingInput"],
        ["unknown", "FunctionError"],
        ["recursive", "FunctionError"],
        ["malformed", "FunctionError"],
      ]) {
        const result = yield* executor.invokeFunction(id!, { value: "test" }).pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure._tag).toBe(tag);
      }
    }),
  );
});
