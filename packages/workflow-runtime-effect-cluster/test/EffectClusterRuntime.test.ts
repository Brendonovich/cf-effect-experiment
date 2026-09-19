import { assert, it } from "@effect/vitest";
import { GraphId, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { DataType, Engine, Module } from "@macrograph/module";
import { ExecutorModules } from "@macrograph/project-host";
import { Array, Effect, Layer, Schema } from "effect";
import { ClusterWorkflowEngine, TestRunner } from "effect/unstable/cluster";

import { EffectClusterRuntime } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {
  value: Schema.String,
}) {}

class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

let executions = 0;

const TestModule = Module.make({
  id: "effect-cluster-test",
  engine: TestEngine,
  effect: (registration) =>
    registration.schema.register({
      id: "trigger",
      type: "event",
      event: () => Effect.succeed(true),
      io: (io) => ({ value: io.data.out("value", DataType.String) }),
      run: ({ event, io }) =>
        Effect.gen(function* () {
          if (event === undefined) return yield* Effect.die("Expected event payload");
          executions++;
          io.value(event.value);
        }),
    }),
});

const TestDeployment = Engine.deployment(
  TestModule,
  TestEngine.toLayer(() => Effect.die("not hosted")),
);

const modules = ExecutorModules.make([ExecutorModules.entry(TestModule, Trigger, TestDeployment)]);

const graphId = GraphId.make("graph");
const nodeId = NodeId.make("trigger");
const project: Project.Model = {
  ...Project.empty(),
  graphs: {
    [graphId]: {
      canvas: {
        id: graphId,
        name: "Effect Cluster",
        nodes: {
          [nodeId]: {
            id: nodeId,
            name: "Trigger",
            schema: {
              package: PackageId.make(TestModule.id),
              schema: SchemaId.make("trigger"),
            },
            properties: {},
            inputDefaults: {},
            foldPins: false,
            position: { x: 0, y: 0 },
          },
        },
        connections: [],
      },
    },
  },
};

const ClusterLayer = ClusterWorkflowEngine.layer.pipe(Layer.provide(TestRunner.layer));
const TestLayer = EffectClusterRuntime.layer({ modules }).pipe(Layer.provideMerge(ClusterLayer));

it.effect("executes nodes as idempotent Effect Cluster workflow activities", () =>
  Effect.scoped(
    Effect.gen(function* () {
      executions = 0;
      const payload = {
        executionId: "execution-1",
        projectId: "project-1",
        moduleId: TestModule.id,
        event: { _tag: "Trigger", value: "durable" },
        project,
      };
      assert.deepStrictEqual(yield* EffectClusterRuntime.GraphExecutionWorkflow.execute(payload), {
        executionId: payload.executionId,
        projectId: payload.projectId,
      });
      assert.strictEqual(executions, 1);

      yield* EffectClusterRuntime.GraphExecutionWorkflow.execute(payload);
      assert.strictEqual(executions, 1);
    }).pipe(Effect.provide(TestLayer)),
  ),
);
