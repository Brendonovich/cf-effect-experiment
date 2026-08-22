import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  GraphId,
  IoId,
  NodeId,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { Engine, Plugin } from "@macrograph/plugin";
import { Array, Effect, Ref, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Ping extends Schema.TaggedClass<Ping>()("Ping", {
  message: Schema.String,
}) {}

class Pong extends Schema.TaggedClass<Pong>()("Pong", {}) {}

class TestEngine extends Engine.make({ events: Array.empty<Ping | Pong>() }) {}

describe("Executor", () => {
  it.effect("executes matching event graphs with data and pure inputs", () =>
    Effect.gen(function* () {
      const executions = yield* Ref.make<ReadonlyArray<string>>([]);
      const pureRuns = yield* Ref.make(0);
      const checkpoints = new Map<string, Executor.NodeExecutionResult>();
      const executionDriver: Executor.ExecutionDriver = {
        executeNode: (key, effect) => {
          const id = JSON.stringify(key);
          const cached = checkpoints.get(id);
          if (cached !== undefined) return Effect.succeed(structuredClone(cached));
          return effect.pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                checkpoints.set(id, structuredClone(result));
              }),
            ),
          );
        },
      };
      const plugin = Plugin.make({
        id: "test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "ping",
            type: "event",
            event: (event) => Effect.succeed(event._tag === "Ping"),
            io: (io) => ({
              message: io.data.out<string>("message"),
            }),
            run: ({ event, io }) =>
              Effect.sync(() => {
                if (event?._tag === "Ping") io.message(event.message);
              }),
          });
          yield* context.schema.register({
            id: "uppercase",
            type: "pure",
            io: (io) => ({
              value: io.data.in<string>("value"),
              result: io.data.out<string>("result"),
            }),
            run: ({ io }) =>
              Ref.update(pureRuns, (count) => count + 1).pipe(
                Effect.andThen(Effect.sync(() => io.result(io.value.toUpperCase()))),
              ),
          });
          yield* context.schema.register({
            id: "record",
            type: "exec",
            io: (io) => ({
              message: io.data.in<string>("message"),
              upper: io.data.in<string>("upper"),
              upperAgain: io.data.in<string>("upperAgain"),
              suffix: io.data.in<string>("suffix"),
              empty: io.data.in<string>("empty", { defaultValue: "" }),
            }),
            run: ({ io }) =>
              Ref.update(executions, (values) => [
                ...values,
                `${io.message}:${io.upper}:${io.upperAgain}${io.suffix}${io.empty}`,
              ]),
          });
        }),
      });
      const deployment = Engine.deployment(
        plugin,
        TestEngine.toLayer(() => Effect.die("Test engine is not hosted")),
      );

      const graphId = GraphId.make("main");
      const eventNodeId = NodeId.make("event");
      const pureNodeId = NodeId.make("pure");
      const actionNodeId = NodeId.make("action");
      const project: Project.Model = {
        name: "Executor test",
        engines: {},
        graphs: {
          [graphId]: {
            id: graphId,
            name: "Main",
            nodes: {
              [eventNodeId]: {
                id: eventNodeId,
                name: "Ping",
                properties: {},
                schema: { package: PackageId.make("test"), schema: SchemaId.make("ping") },
                position: { x: 0, y: 0 },
              },
              [pureNodeId]: {
                id: pureNodeId,
                name: "Uppercase",
                properties: { value: "hello" },
                schema: {
                  package: PackageId.make("test"),
                  schema: SchemaId.make("uppercase"),
                },
                position: { x: 100, y: 100 },
              },
              [actionNodeId]: {
                id: actionNodeId,
                name: "Record",
                properties: { suffix: "!" },
                schema: { package: PackageId.make("test"), schema: SchemaId.make("record") },
                position: { x: 200, y: 0 },
              },
            },
            connections: [
              {
                id: ConnectionId.make("exec"),
                outNodeId: eventNodeId,
                outIoId: IoId.make("exec"),
                inNodeId: actionNodeId,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("message"),
                outNodeId: eventNodeId,
                outIoId: IoId.make("message"),
                inNodeId: actionNodeId,
                inIoId: IoId.make("message"),
              },
              {
                id: ConnectionId.make("upper"),
                outNodeId: pureNodeId,
                outIoId: IoId.make("result"),
                inNodeId: actionNodeId,
                inIoId: IoId.make("upper"),
              },
              {
                id: ConnectionId.make("upper-again"),
                outNodeId: pureNodeId,
                outIoId: IoId.make("result"),
                inNodeId: actionNodeId,
                inIoId: IoId.make("upperAgain"),
              },
            ],
          },
        },
      };

      const executor = yield* Executor.make(Project.empty(), { executionDriver });
      yield* executor.plugin(plugin, deployment);
      yield* executor.loadProject(project);

      yield* executor.handleEvent(plugin, new Pong());
      assert.deepStrictEqual(yield* Ref.get(executions), []);

      yield* executor.handleEvent(plugin, new Ping({ message: "received" }));
      assert.deepStrictEqual(yield* Ref.get(executions), ["received:HELLO:HELLO!"]);
      assert.strictEqual(yield* Ref.get(pureRuns), 1);
      assert.deepStrictEqual(yield* executor.project, project);

      const replayed = yield* Executor.make(project, { executionDriver });
      yield* replayed.plugin(plugin, deployment);
      yield* replayed.handleEvent(plugin, new Ping({ message: "received" }));
      assert.deepStrictEqual(yield* Ref.get(executions), ["received:HELLO:HELLO!"]);
      assert.strictEqual(yield* Ref.get(pureRuns), 2);
      assert.strictEqual(checkpoints.size, 2);
    }),
  );

  it.effect("rejects events from unregistered plugins", () =>
    Effect.gen(function* () {
      const plugin = Plugin.make({
        id: "test",
        engine: TestEngine,
        effect: () => Effect.void,
      });
      const executor = yield* Executor.make(Project.empty());
      const error = yield* Effect.flip(executor.handleEvent(plugin, new Pong()));
      assert.strictEqual(error._tag, "PluginNotRegistered");
    }),
  );
});
