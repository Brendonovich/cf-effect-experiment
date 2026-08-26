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

class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

describe("schema execution context", () => {
  it.effect("identifies project, graph, node, and parent traces across execution fan-out", () =>
    Effect.gen(function* () {
      const contexts = yield* Ref.make<
        ReadonlyArray<{
          readonly projectId: string;
          readonly graphId: string;
          readonly eventNodeId: string;
          readonly executionTraceId: string;
          readonly nodeId: string;
          readonly executionPath: string;
          readonly nodeTraceId: string;
          readonly parentTraceId?: string;
        }>
      >([]);
      const keys = yield* Ref.make<ReadonlyArray<Executor.NodeExecutionKey>>([]);
      const executionDriver: Executor.ExecutionDriver = {
        executeNode: (key, effect) =>
          Ref.update(keys, (current) => [...current, key]).pipe(Effect.andThen(effect)),
      };
      const plugin = Plugin.make({
        id: "context",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (registration) {
          const capture = (
            execution: {
              readonly projectId: string;
              readonly graphId: string;
              readonly eventNodeId: string;
              readonly traceId: string;
            },
            node: {
              readonly nodeId: string;
              readonly executionPath: string;
              readonly traceId: string;
              readonly parentTraceId?: string;
              readonly withSpan: <A, E, R>(
                name: string,
                effect: Effect.Effect<A, E, R>,
              ) => Effect.Effect<A, E, R>;
            },
          ) =>
            node.withSpan(
              "context.capture",
              Ref.update(contexts, (current) => [
                ...current,
                {
                  projectId: execution.projectId,
                  graphId: execution.graphId,
                  eventNodeId: execution.eventNodeId,
                  executionTraceId: execution.traceId,
                  nodeId: node.nodeId,
                  executionPath: node.executionPath,
                  nodeTraceId: node.traceId,
                  ...(node.parentTraceId === undefined
                    ? {}
                    : { parentTraceId: node.parentTraceId }),
                },
              ]),
            );
          yield* registration.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: () => ({}),
            run: ({ execution, node }) => capture(execution, node),
          });
          yield* registration.schema.register({
            id: "action",
            io: (io) => ({ alternate: io.exec.in("alternate") }),
            run: ({ execution, node }) => capture(execution, node),
          });
        }),
      });
      const deployment = Engine.deployment(
        plugin,
        TestEngine.toLayer(() => Effect.die("Test engine is not hosted")),
      );
      const graphId = GraphId.make("context-graph");
      const eventNodeId = NodeId.make("context-event");
      const actionNodeId = NodeId.make("context-action");
      const secondActionNodeId = NodeId.make("context-action-2");
      const project: Project.Model = {
        name: "Context",
        engines: {},
        constants: {},
        graphs: {
          [graphId]: {
            id: graphId,
            name: "Context",
            nodes: {
              [eventNodeId]: {
                id: eventNodeId,
                name: "Event",
                properties: {},
                inputDefaults: {},
                foldPins: false,
                schema: { package: PackageId.make("context"), schema: SchemaId.make("event") },
                position: { x: 0, y: 0 },
              },
              [actionNodeId]: {
                id: actionNodeId,
                name: "Action",
                properties: {},
                inputDefaults: {},
                foldPins: false,
                schema: { package: PackageId.make("context"), schema: SchemaId.make("action") },
                position: { x: 100, y: 0 },
              },
              [secondActionNodeId]: {
                id: secondActionNodeId,
                name: "Second Action",
                properties: {},
                inputDefaults: {},
                foldPins: false,
                schema: { package: PackageId.make("context"), schema: SchemaId.make("action") },
                position: { x: 100, y: 100 },
              },
            },
            connections: [
              {
                id: ConnectionId.make("context-exec"),
                outNodeId: eventNodeId,
                outIoId: IoId.make("exec"),
                inNodeId: actionNodeId,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("context-exec-2"),
                outNodeId: eventNodeId,
                outIoId: IoId.make("exec"),
                inNodeId: actionNodeId,
                inIoId: IoId.make("alternate"),
              },
            ],
          },
        },
      };
      const executor = yield* Executor.make(project, {
        projectId: "project-123",
        executionDriver,
      });
      yield* executor.plugin(plugin, deployment);
      yield* executor.handleEvent(plugin, new Trigger({}));

      const seen = yield* Ref.get(contexts);
      assert.strictEqual(seen.length, 3);
      assert.strictEqual(seen[0]?.projectId, "project-123");
      assert.strictEqual(seen[0]?.graphId, graphId);
      assert.strictEqual(seen[0]?.eventNodeId, eventNodeId);
      assert.strictEqual(seen[0]?.nodeId, eventNodeId);
      assert.strictEqual(seen[0]?.executionPath, `event:${eventNodeId}`);
      assert.strictEqual(seen[0]?.parentTraceId, undefined);
      assert.strictEqual(seen[1]?.nodeId, actionNodeId);
      assert.strictEqual(seen[1]?.parentTraceId, seen[0]?.nodeTraceId);
      assert.strictEqual(seen[1]?.executionPath, `event:${eventNodeId}/exec:context-exec`);
      assert.strictEqual(seen[1]?.executionTraceId, seen[0]?.executionTraceId);
      assert.strictEqual(seen[2]?.nodeId, actionNodeId);
      assert.strictEqual(seen[2]?.parentTraceId, seen[0]?.nodeTraceId);
      assert.strictEqual(
        seen[2]?.executionPath,
        `event:${eventNodeId}/exec:context-exec-2`,
      );
      const driverKeys = yield* Ref.get(keys);
      assert.strictEqual(driverKeys[0]?.traceId, seen[0]?.nodeTraceId);
      assert.strictEqual(driverKeys[1]?.parentTraceId, seen[0]?.nodeTraceId);
      assert.strictEqual(driverKeys[2]?.parentTraceId, seen[0]?.nodeTraceId);
    }),
  );
});
