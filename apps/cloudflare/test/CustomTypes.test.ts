import { assert, describe, it } from "@effect/vitest";
import { CustomTypes, Project, RenderedProject } from "@macrograph/core";
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
              { id: "exec", outNodeId: "tick", outIo: { _tag: "Port" as const, id: "exec" }, inNodeId: "match", inIoId: "exec" },
            ],
          },
        },
      });
      // Deployment writes RenderedProject while workflow reads the compatible Project model.
      const rendered = Schema.decodeUnknownSync(RenderedProject.Model)({ ...project, graphs: {} });
      const deployed = Schema.decodeUnknownSync(Project.Model)(
        JSON.parse(JSON.stringify(Schema.encodeUnknownSync(RenderedProject.Model)(rendered))),
      );
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
        outputs: [{ outputId: 'variant:"Found"/field:"items"', value: [1, 2, 3] }],
        executionOutputId: 'variant:"Found"',
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
