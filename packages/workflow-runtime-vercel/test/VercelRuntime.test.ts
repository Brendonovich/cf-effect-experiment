import { assert, it } from "@effect/vitest";
import { GraphId, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { DataType, Engine, Module } from "@macrograph/module";
import { ExecutorModules } from "@macrograph/project-host";
import { Array, Effect, Schema } from "effect";

import { VercelRuntime } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {
  value: Schema.String,
}) {}

class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

let executions = 0;

const TestModule = Module.make({
  id: "vercel-test",
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

const deployment = Engine.deployment(
  TestModule,
  TestEngine.toLayer(() => Effect.die("not hosted")),
);
const modules = ExecutorModules.make([ExecutorModules.entry(TestModule, Trigger, deployment)]);
const graphId = GraphId.make("graph");
const nodeId = NodeId.make("trigger");
const project: Project.Model = {
  ...Project.empty(),
  graphs: {
    [graphId]: {
      canvas: {
        id: graphId,
        name: "Vercel",
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

it("executes each node through a serialized step request", async () => {
  executions = 0;
  let steps = 0;
  const input: VercelRuntime.ExecutionInput = {
    executionId: "execution-1",
    projectId: "project-1",
    moduleId: TestModule.id,
    event: { _tag: "Trigger", value: "durable" },
    project,
  };
  assert.deepStrictEqual(
    await VercelRuntime.runWorkflow(input, {
      modules,
      executeNode: async (nodeInput) => {
        steps++;
        const serialized = JSON.parse(JSON.stringify(nodeInput));
        return VercelRuntime.runNodeStep(
          Schema.decodeUnknownSync(VercelRuntime.NodeStepInput)(serialized),
          { modules },
        );
      },
    }),
    { executionId: "execution-1", projectId: "project-1" },
  );
  assert.strictEqual(steps, 1);
  assert.strictEqual(executions, 1);
});
