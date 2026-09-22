import { GraphId, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { DataType, Engine, Module } from "@macrograph/module";
import { ExecutorModules } from "@macrograph/project-host";
import { Array, Effect, Schema } from "effect";

export class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {
  value: Schema.String,
}) {}

export const RunRequest = Schema.Struct({ executionId: Schema.String, value: Schema.String });

class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

export const makeModules = (
  onExecute: (value: string) => Effect.Effect<void> = () => Effect.void,
) => {
  const module = Module.make({
    id: "infra-test",
    engine: TestEngine,
    effect: (registration) =>
      registration.schema.register({
        id: "trigger",
        type: "event",
        event: () => Effect.succeed(true),
        io: (io) => ({ value: io.data.out("value", DataType.String) }),
        run: ({ event, io }) =>
          Effect.gen(function* () {
            if (event === undefined) return yield* Effect.die("Missing test event");
            if (event.value === "fail")
              return yield* Effect.die("Intentional infrastructure test failure");
            if (event.value !== "durable") return yield* Effect.die("Unexpected test event");
            yield* onExecute(event.value);
            io.value(event.value);
          }),
      }),
  });
  const deployment = Engine.deployment(
    module,
    TestEngine.toLayer(() => Effect.die("Not hosted")),
  );
  return ExecutorModules.make([ExecutorModules.entry(module, Trigger, deployment)]);
};

export const modules = makeModules();
const graphId = GraphId.make("graph");
const nodeId = NodeId.make("trigger");
export const project: Project.Model = {
  ...Project.empty(),
  graphs: {
    [graphId]: {
      canvas: {
        id: graphId,
        name: "Infrastructure test",
        nodes: {
          [nodeId]: {
            id: nodeId,
            name: "Trigger",
            schema: { package: PackageId.make("infra-test"), schema: SchemaId.make("trigger") },
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

export const input = (executionId: string, value = "durable") => ({
  executionId,
  projectId: "infra-project",
  moduleId: "infra-test",
  project,
  event: { _tag: "Trigger", value },
});
