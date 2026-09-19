import { assert, describe, it } from "@effect/vitest";
import { CustomTypes, Project, RenderedProject } from "@macrograph/core";
import { Executor } from "@macrograph/execution";
import { Module } from "@macrograph/module";
import { DataType } from "@macrograph/module/DataType";
import { ProjectExecutor } from "@macrograph/project-host";
import { Effect, Schema } from "effect";

import * as ExecutorModules from "../src/execution/ExecutorModules.ts";

describe("hosted custom types", () => {
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
                source: makeNode("source", "custom-anchor", "source"),
                match: makeNode("match", CustomTypes.packageId, "MatchEnum", {}, {}),
              },
              connections: [
                {
                  id: "exec",
                  outNodeId: "tick",
                  outIo: { _tag: "Port" as const, id: "exec" },
                  inNodeId: "match",
                  inIoId: "exec",
                },
                {
                  id: "value",
                  outNodeId: "source",
                  outIo: { _tag: "Port" as const, id: "value" },
                  inNodeId: "match",
                  inIoId: "value",
                },
              ],
            },
          },
        },
      });
      // The rendered view and executable project retain the same authored type definitions.
      const rendered = Schema.decodeUnknownSync(RenderedProject.Model)({ ...project, graphs: {} });
      const deployed = Schema.decodeUnknownSync(Project.Model)(
        JSON.parse(JSON.stringify(Schema.encodeUnknownSync(Project.Model)(project))),
      );
      const deployedSnapshot = Schema.decodeUnknownSync(RenderedProject.Model)(
        JSON.parse(JSON.stringify(Schema.encodeUnknownSync(RenderedProject.Model)(rendered))),
      );
      assert.deepStrictEqual(deployed.types, types);
      assert.deepStrictEqual(deployedSnapshot.types, types);
      const recorded: Array<{ node: string; output: unknown }> = [];
      const executor = yield* ProjectExecutor.make(
        { ...project, types: deployed.types },
        {
          modules: ExecutorModules.registry,
          executionEnvironment: Executor.durableExecution((key, nodeExecutor) =>
            nodeExecutor.executeNode(key).pipe(
              Effect.map((result) => {
                const replay = JSON.parse(JSON.stringify(result));
                recorded.push({ node: key.nodeId, output: replay });
                return replay;
              }),
            ),
          ),
        },
      );
      yield* executor.module(
        Module.make({
          id: "custom-anchor",
          effect: (context) =>
            context.schema.register({
              id: "source",
              type: "pure",
              io: (io) => ({ value: io.data.out("value", DataType.Custom("result")) }),
              run: ({ io }) =>
                Effect.sync(() => io.value({ _type: "result", _tag: "Found", items: [1, 2, 3] })),
            }),
        }),
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
