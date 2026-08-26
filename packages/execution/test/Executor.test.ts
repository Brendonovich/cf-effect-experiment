import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  GraphId,
  IoId,
  NodeId,
  PackageId,
  Project,
  ResourceConstant,
  SchemaId,
} from "@macrograph/core";
import { DataType, Engine, Plugin, Resource } from "@macrograph/plugin";
import { Array, Effect, Option, Ref, Schema } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/unstable/rpc";

import { Executor } from "../src/index.ts";

class Ping extends Schema.TaggedClass<Ping>()("Ping", {
  message: Schema.String,
}) {}

class Pong extends Schema.TaggedClass<Pong>()("Pong", {}) {}

class TestEngine extends Engine.make({ events: Array.empty<Ping | Pong>() }) {}

describe("Executor", () => {
  it.effect("resolves resource constants and provides the hosted runtime RPC client", () =>
    Effect.gen(function* () {
      class AccountResource extends Resource.make<AccountResource, string>()("account", {
        name: "Account",
      }) {}
      class RuntimeRpcs extends RpcGroup.make(
        Rpc.make("Act", { payload: { account: Schema.String } }),
      ) {}
      class ActionEngine extends Engine.make({
        resources: [AccountResource],
        events: Array.empty<Ping>(),
        rpcs: RuntimeRpcs,
      }) {}
      const calls = yield* Ref.make<ReadonlyArray<string>>([]);
      const plugin = Plugin.make({
        id: "resource-action",
        engine: ActionEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            properties: { account: { name: "Account", resource: AccountResource } },
            event: (_event, { properties }) => Effect.succeed(properties.account === "account-1"),
            io: () => ({}),
            run: () => Effect.void,
          });
          yield* context.schema.register({
            id: "action",
            properties: { account: { name: "Account", resource: AccountResource } },
            io: () => ({}),
            run: ({ properties, engine }) => engine.Act({ account: properties.account }),
          });
        }),
      });
      const deployment = Engine.deployment(
        plugin,
        ActionEngine.toLayer(() => Effect.die("not needed")),
      );
      const runtime = yield* RpcTest.makeClient(RuntimeRpcs).pipe(
        Effect.provide(
          RuntimeRpcs.toLayer({
            Act: ({ account }) => Ref.update(calls, (current) => [...current, account]),
          }),
        ),
      );
      const graphId = GraphId.make("resource-graph");
      const eventNodeId = NodeId.make("resource-event");
      const actionNodeId = NodeId.make("resource-action");
      const project: Project.Model = {
        name: "Resources",
        engines: {},
        constants: {
          account: {
            id: ResourceConstant.Id.make("account"),
            name: "Streamer",
            resource: { package: "resource-action", resource: "account" },
            value: "account-1",
          },
        },
        graphs: {
          [graphId]: {
            id: graphId,
            name: "Resources",
            nodes: {
              [eventNodeId]: {
                id: eventNodeId,
                name: "Event",
                properties: { account: "account" },
                inputDefaults: {},
                foldPins: false,
                schema: {
                  package: PackageId.make("resource-action"),
                  schema: SchemaId.make("event"),
                },
                position: { x: 0, y: 0 },
              },
              [actionNodeId]: {
                id: actionNodeId,
                name: "Action",
                properties: { account: "account" },
                inputDefaults: {},
                foldPins: false,
                schema: {
                  package: PackageId.make("resource-action"),
                  schema: SchemaId.make("action"),
                },
                position: { x: 100, y: 0 },
              },
            },
            connections: [
              {
                id: ConnectionId.make("resource-exec"),
                outNodeId: eventNodeId,
                outIoId: IoId.make("exec"),
                inNodeId: actionNodeId,
                inIoId: IoId.make("exec"),
              },
            ],
          },
        },
      };
      const executor = yield* Executor.make(project, {
        engineClient: () => Effect.succeed(runtime),
        resourceValues: () => Effect.succeed([{ id: "account-1", display: "Streamer" }]),
      });
      yield* executor.plugin(plugin, deployment);
      yield* executor.handleEvent(plugin, new Ping({ message: "go" }));
      assert.deepStrictEqual(yield* Ref.get(calls), ["account-1"]);

      const unavailable = yield* Executor.make(project, {
        resourceValues: () => Effect.succeed([{ id: "account-1", display: "Streamer" }]),
      });
      yield* unavailable.plugin(plugin, deployment);
      const unavailableResult = yield* unavailable
        .handleEvent(plugin, new Ping({ message: "go" }))
        .pipe(Effect.result);
      assert(unavailableResult._tag === "Failure");
      if (unavailableResult._tag === "Failure")
        assert.strictEqual(unavailableResult.failure._tag, "EngineClientUnavailable");

      yield* executor.loadProject({
        ...project,
        constants: {
          account: { ...project.constants.account!, value: "missing" },
        },
      });
      const invalid = yield* executor
        .handleEvent(plugin, new Ping({ message: "go" }))
        .pipe(Effect.result);
      assert(invalid._tag === "Failure");
      if (invalid._tag === "Failure")
        assert.strictEqual(invalid.failure._tag, "ResourceResolutionError");
    }),
  );

  it.effect("executes matching event graphs with data and pure inputs", () =>
    Effect.gen(function* () {
      const executions = yield* Ref.make<ReadonlyArray<string>>([]);
      const pureRuns = yield* Ref.make(0);
      const checkpoints = new Map<string, Executor.NodeExecutionResult>();
      const executionDriver: Executor.ExecutionDriver = {
        executeNode: (key, effect) => {
          const id = JSON.stringify({
            projectId: key.projectId,
            graphId: key.graphId,
            eventNodeId: key.eventNodeId,
            nodeId: key.nodeId,
            kind: key.kind,
          });
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
              message: io.data.out("message", DataType.String),
              optional: io.data.out("optional", DataType.Option(DataType.String)),
            }),
            run: ({ event, io }) =>
              Effect.sync(() => {
                if (event?._tag === "Ping") {
                  io.message(event.message);
                  io.optional(Option.some(event.message));
                }
              }),
          });
          yield* context.schema.register({
            id: "uppercase",
            type: "pure",
            io: (io) => ({
              value: io.data.in("value", DataType.String),
              result: io.data.out("result", DataType.String),
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
              message: io.data.in("message", DataType.String),
              upper: io.data.in("upper", DataType.String),
              upperAgain: io.data.in("upperAgain", DataType.String),
              suffix: io.data.in("suffix", DataType.String),
              empty: io.data.in("empty", DataType.String, { defaultValue: "" }),
              fallback: io.data.in("fallback", DataType.String, { defaultValue: "plugin" }),
              optional: io.data.in("optional", DataType.Option(DataType.String), {
                defaultValue: Option.none(),
              }),
            }),
            run: ({ io }) =>
              Ref.update(executions, (values) => [
                ...values,
                `${io.message}:${io.upper}:${io.upperAgain}${io.suffix}${io.empty}:${io.fallback}:${Option.getOrElse(io.optional, () => "none")}`,
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
        constants: {},
        graphs: {
          [graphId]: {
            id: graphId,
            name: "Main",
            nodes: {
              [eventNodeId]: {
                id: eventNodeId,
                name: "Ping",
                properties: {},
                inputDefaults: {},
                foldPins: false,
                schema: { package: PackageId.make("test"), schema: SchemaId.make("ping") },
                position: { x: 0, y: 0 },
              },
              [pureNodeId]: {
                id: pureNodeId,
                name: "Uppercase",
                properties: {},
                inputDefaults: { value: "hello" },
                foldPins: false,
                schema: {
                  package: PackageId.make("test"),
                  schema: SchemaId.make("uppercase"),
                },
                position: { x: 100, y: 100 },
              },
              [actionNodeId]: {
                id: actionNodeId,
                name: "Record",
                properties: { suffix: "property", fallback: "property" },
                inputDefaults: {
                  suffix: "!",
                  optional: { _tag: "Some", value: "stored" },
                },
                foldPins: false,
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
      assert.deepStrictEqual(yield* Ref.get(executions), ["received:HELLO:HELLO!:plugin:stored"]);
      assert.strictEqual(yield* Ref.get(pureRuns), 1);
      assert.deepStrictEqual(yield* executor.project, project);

      const replayed = yield* Executor.make(project, { executionDriver });
      yield* replayed.plugin(plugin, deployment);
      yield* replayed.handleEvent(plugin, new Ping({ message: "received" }));
      assert.deepStrictEqual(yield* Ref.get(executions), ["received:HELLO:HELLO!:plugin:stored"]);
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

  it.effect("executes property-generated node IO", () =>
    Effect.gen(function* () {
      const values = yield* Ref.make<ReadonlyArray<string>>([]);
      const plugin = Plugin.make({
        id: "dynamic",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: (event) => Effect.succeed(event._tag === "Ping"),
            io: (io, properties) => ({
              value: io.data.out(
                typeof properties.output === "string" ? properties.output : "value",
                DataType.String,
              ),
            }),
            run: ({ event, io }) =>
              Effect.sync(() => {
                if (event?._tag === "Ping") io.value(event.message);
              }),
          });
          yield* context.schema.register({
            id: "record",
            io: (io, properties) => ({
              value: io.data.in(
                typeof properties.input === "string" ? properties.input : "value",
                DataType.String,
              ),
            }),
            run: ({ io }) => Ref.update(values, (current) => [...current, io.value]),
          });
        }),
      });
      const deployment = Engine.deployment(
        plugin,
        TestEngine.toLayer(() => Effect.die("Test engine is not hosted")),
      );
      const graphId = GraphId.make("dynamic");
      const eventId = NodeId.make("dynamic-event");
      const recordId = NodeId.make("dynamic-record");
      const project: Project.Model = {
        name: "Dynamic execution",
        engines: {},
        constants: {},
        graphs: {
          [graphId]: {
            id: graphId,
            name: "Dynamic",
            nodes: {
              [eventId]: {
                id: eventId,
                name: "Event",
                properties: { output: "message" },
                inputDefaults: {},
                foldPins: false,
                schema: {
                  package: PackageId.make("dynamic"),
                  schema: SchemaId.make("event"),
                },
                position: { x: 0, y: 0 },
              },
              [recordId]: {
                id: recordId,
                name: "Record",
                properties: { input: "message" },
                inputDefaults: {},
                foldPins: false,
                schema: {
                  package: PackageId.make("dynamic"),
                  schema: SchemaId.make("record"),
                },
                position: { x: 100, y: 0 },
              },
            },
            connections: [
              {
                id: ConnectionId.make("dynamic-exec"),
                outNodeId: eventId,
                outIoId: IoId.make("exec"),
                inNodeId: recordId,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("dynamic-data"),
                outNodeId: eventId,
                outIoId: IoId.make("message"),
                inNodeId: recordId,
                inIoId: IoId.make("message"),
              },
            ],
          },
        },
      };

      const executor = yield* Executor.make(project);
      yield* executor.plugin(plugin, deployment);
      yield* executor.handleEvent(plugin, new Ping({ message: "dynamic value" }));
      assert.deepStrictEqual(yield* Ref.get(values), ["dynamic value"]);

      const graph = project.graphs[graphId]!;
      yield* executor.loadProject({
        ...project,
        graphs: {
          ...project.graphs,
          [graphId]: {
            ...graph,
            connections: [
              ...graph.connections,
              {
                id: ConnectionId.make("duplicate-exec"),
                outNodeId: eventId,
                outIoId: IoId.make("exec"),
                inNodeId: recordId,
                inIoId: IoId.make("exec"),
              },
            ],
          },
        },
      });
      const error = yield* Effect.flip(
        executor.handleEvent(plugin, new Ping({ message: "duplicate" })),
      );
      assert.strictEqual(error._tag, "InvalidConnection");
      if (error._tag === "InvalidConnection") {
        assert.strictEqual(error.reason, "Input exec has multiple connections");
      }
    }),
  );
});
