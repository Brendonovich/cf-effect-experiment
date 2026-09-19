import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  CustomTypes,
  Function as GraphFunction,
  GraphId,
  IoId,
  OutputRef,
  Project,
  RenderedProject,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { ProjectExecutor } from "@macrograph/project-host";
import { Effect, Schema } from "effect";

import { DeploymentArtifact } from "../src/deployment/DeploymentArtifact.ts";
import * as ExecutorModules from "../src/execution/ExecutorModules.ts";

describe("hosted deployment snapshots", () => {
  it.effect("keeps rendered function graphs separate from executable cloud projects", () =>
    Effect.gen(function* () {
      const functionId = GraphId.make("identity");
      const value = { id: IoId.make("value"), name: "Value", type: DataType.String };
      const connection = (outIo: string, inIoId: string) => ({
        id: ConnectionId.make(crypto.randomUUID()),
        outNodeId: GraphFunction.InputBoundaryNodeId,
        outIo: OutputRef.port(outIo),
        inNodeId: GraphFunction.OutputBoundaryNodeId,
        inIoId: IoId.make(inIoId),
      });
      const fn: GraphFunction.Model = {
        canvas: {
          id: functionId,
          name: "Identity",
          nodes: {},
          connections: [
            connection(GraphFunction.ExecutionIoId, GraphFunction.ExecutionIoId),
            connection(value.id, value.id),
          ],
        },
        arguments: [value],
        returns: [value],
        inputPosition: { x: 0, y: 0 },
        outputPosition: { x: 400, y: 0 },
      };
      const rendered: RenderedProject.Model = {
        ...Project.empty(),
        graphs: {
          [functionId]: {
            ...fn.canvas,
            nodes: {},
            schemas: {},
          },
        },
        functions: { [functionId]: fn },
      };
      const encoded = Schema.encodeUnknownSync(DeploymentArtifact.Model)({
        project: { ...Project.empty(), functions: { [functionId]: fn } },
        snapshot: rendered,
      });
      const artifact = Schema.decodeUnknownSync(DeploymentArtifact.Model)(
        JSON.parse(JSON.stringify(encoded)),
      );
      assert.property(artifact.snapshot.graphs, functionId);
      assert.deepStrictEqual(artifact.project.graphs, {});
      const executor = yield* ProjectExecutor.make(artifact.project, {
        modules: ExecutorModules.registry,
      });
      assert.deepStrictEqual(yield* executor.invokeFunction(functionId, { value: "cloud" }), {
        value: "cloud",
      });
    }),
  );

  it.effect("retains deployment definitions and replays tagged match outputs as JSON", () =>
    Effect.gen(function* () {
      const types: DataType.Definitions = {
        result: {
          _tag: "Enum",
          id: DataType.DefinitionId.make("result"),
          name: "Result",
          variants: [
            { name: "Empty", fields: [] },
            { name: "Found", fields: [{ name: "items", type: DataType.List(DataType.Int) }] },
          ],
        },
      };
      const makeNode = (
        id: string,
        pkg: string,
        schema: string,
        defaults = {},
        properties = {},
      ) => ({
        id,
        name: id,
        schema: { package: pkg, schema },
        position: { x: 0, y: 0 },
        properties,
        inputDefaults: defaults,
      });
      const project = Schema.decodeUnknownSync(Project.Model)({
        ...Project.empty(),
        types,
        graphs: {
          graph: {
            canvas: {
              id: "graph",
              name: "Hosted custom types",
              nodes: {
                tick: makeNode("tick", "util", "Tick"),
                match: makeNode(
                  "match",
                  CustomTypes.packageId,
                  "MatchEnum",
                  {
                    value: { _type: "result", _tag: "Found", items: [1, 2, 3] },
                  },
                  { type: "result" },
                ),
              },
              connections: [
                {
                  id: "exec",
                  outNodeId: "tick",
                  outIo: { _tag: "Port" as const, id: "exec" },
                  inNodeId: "match",
                  inIoId: "exec",
                },
              ],
            },
          },
        },
      });
      // The rendered view and executable project retain the same authored type definitions.
      const rendered = Schema.decodeUnknownSync(RenderedProject.Model)({ ...project, graphs: {} });
      const deployed = Schema.decodeUnknownSync(DeploymentArtifact.Model)(
        JSON.parse(
          JSON.stringify(
            Schema.encodeUnknownSync(DeploymentArtifact.Model)({ project, snapshot: rendered }),
          ),
        ),
      ).project;
      assert.deepStrictEqual(deployed.types, types);
      const recorded: Array<{ node: string; output: unknown }> = [];
      const executor = yield* ProjectExecutor.make(
        { ...project, types: deployed.types },
        {
          modules: ExecutorModules.registry,
          executionDriver: {
            executeNode: (key, effect) =>
              effect.pipe(
                Effect.map((result) => {
                  const replay = JSON.parse(JSON.stringify(result));
                  recorded.push({ node: key.nodeId, output: replay });
                  return replay;
                }),
              ),
          },
        },
      );
      yield* ExecutorModules.registry.handle(executor, "util", { _tag: "TickEvent", tick: 1 });
      assert.deepStrictEqual(recorded.find((step) => step.node === "match")?.output, {
        outputs: [],
        executionOutputId: 'variant:"Found"',
        scopePayload: { 'field:"items"': [1, 2, 3] },
      });
      yield* executor.loadProject({ ...project, types: {} });
      const count = recorded.length;
      const failure = yield* Effect.flip(
        ExecutorModules.registry.handle(executor, "util", { _tag: "TickEvent", tick: 2 }),
      );
      assert.strictEqual(failure._tag, "InvalidGraph");
      assert.strictEqual(
        recorded.length,
        count,
        "deleted type must block the event before durable side effects",
      );
    }),
  );
});
