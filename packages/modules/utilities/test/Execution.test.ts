import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  GraphId,
  IoId,
  NodeId,
  PackageId,
  type Project,
  SchemaId,
} from "@macrograph/core";
import { Executor } from "@macrograph/execution";
import { Module, Engine } from "@macrograph/module";
import LogicModuleDefinition from "@macrograph/module-logic";
import { Effect, Logger, Schema, Tracer } from "effect";

import { TickEvent } from "../src/Definition.ts";
import UtilitiesDeploymentDefinition from "../src/Deployment.ts";
import UtilitiesModuleDefinition from "../src/Module.ts";

const UtilitiesDeployment = Engine.identify(
  Module.builtinId("utilities"),
  UtilitiesDeploymentDefinition,
);
const UtilitiesModule = Module.identify(Module.builtinId("utilities"), UtilitiesModuleDefinition);

const LogicModule = Module.identify(Module.builtinId("logic"), LogicModuleDefinition);

const node = (
  id: string,
  schema: string,
  properties: Readonly<Record<string, Schema.Json>>,
  inputDefaults: Readonly<Record<string, Schema.Json>>,
  packageId = "macrograph.app/macrograph/utilities",
) => ({
  id: NodeId.make(id),
  name: id,
  schema: { package: PackageId.make(packageId), schema: SchemaId.make(schema) },
  properties,
  inputDefaults,
  foldPins: false,
  position: { x: 0, y: 0 },
});

describe("Utilities execution", () => {
  it.effect("matches Tick intervals and follows only the selected Branch path", () =>
    Effect.gen(function* () {
      const graphId = GraphId.make("utilities");
      const tick = node("tick", "Tick", { intervalSeconds: 2 }, {});
      const branch = node(
        "branch",
        "Branch",
        {},
        { condition: true },
        "macrograph.app/macrograph/logic",
      );
      const whenTrue = node("true", "Print", {}, { in: "true" });
      const alsoTrue = node("also-true", "Print", {}, { in: "also true" });
      const whenFalse = node("false", "Print", {}, { in: "false" });
      const project: Project.Model = {
        name: "Utilities",
        functions: {},
        engines: {},
        constants: {},
        types: {},
        queues: {},
        graphs: {
          [graphId]: {
            canvas: {
              id: graphId,
              name: "Utilities",
              nodes: {
                [tick.id]: tick,
                [branch.id]: branch,
                [whenTrue.id]: whenTrue,
                [alsoTrue.id]: alsoTrue,
                [whenFalse.id]: whenFalse,
              },
              connections: [
                {
                  id: ConnectionId.make("tick-branch"),
                  outNodeId: tick.id,
                  outIo: { _tag: "Port" as const, id: IoId.make("exec") },
                  inNodeId: branch.id,
                  inIoId: IoId.make("exec"),
                },
                {
                  id: ConnectionId.make("branch-true"),
                  outNodeId: branch.id,
                  outIo: { _tag: "Port" as const, id: IoId.make("true") },
                  inNodeId: whenTrue.id,
                  inIoId: IoId.make("exec"),
                },
                {
                  id: ConnectionId.make("branch-false"),
                  outNodeId: branch.id,
                  outIo: { _tag: "Port" as const, id: IoId.make("false") },
                  inNodeId: whenFalse.id,
                  inIoId: IoId.make("exec"),
                },
                {
                  id: ConnectionId.make("branch-also-true"),
                  outNodeId: branch.id,
                  outIo: { _tag: "Port" as const, id: IoId.make("true") },
                  inNodeId: alsoTrue.id,
                  inIoId: IoId.make("exec"),
                },
              ],
            },
          },
        },
      };
      const messages: Array<unknown> = [];
      const spans: Array<Tracer.Span> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const logger = Logger.make<unknown, void>((options) => {
        messages.push(options.message);
      });
      const executor = yield* Executor.make(project);
      yield* executor.module(UtilitiesModule, UtilitiesDeployment);
      yield* executor.module(LogicModule);

      yield* executor.handleEvent(UtilitiesModule, new TickEvent({ tick: 1 }));
      assert.deepStrictEqual(messages, []);
      yield* executor
        .handleEvent(UtilitiesModule, new TickEvent({ tick: 2 }))
        .pipe(Effect.provide(Logger.layer([logger])), Effect.provideService(Tracer.Tracer, tracer));
      assert.deepStrictEqual(messages, [
        ["Utilities Print", { value: "true" }],
        ["Utilities Print", { value: "also true" }],
      ]);

      yield* executor.loadProject({
        ...project,
        graphs: {
          [graphId]: {
            canvas: {
              ...project.graphs[graphId]!.canvas,
              nodes: {
                ...project.graphs[graphId]!.canvas.nodes,
                [branch.id]: { ...branch, inputDefaults: { condition: false } },
              },
            },
          },
        },
      });
      yield* executor
        .handleEvent(UtilitiesModule, new TickEvent({ tick: 4 }))
        .pipe(Effect.provide(Logger.layer([logger])), Effect.provideService(Tracer.Tracer, tracer));
      assert.deepStrictEqual(messages, [
        ["Utilities Print", { value: "true" }],
        ["Utilities Print", { value: "also true" }],
        ["Utilities Print", { value: "false" }],
      ]);
      const printSpans = spans.filter(
        (span) => span.name === "Schema.run macrograph.app/macrograph/utilities.Print",
      );
      assert.lengthOf(printSpans, 3);
      for (const [index, span] of printSpans.entries()) {
        assert.strictEqual(span?._tag, "Span");
        if (span?._tag === "Span") {
          assert.strictEqual(span.name, "Schema.run macrograph.app/macrograph/utilities.Print");
          assert.strictEqual(
            span.attributes.get("macrograph.module.id"),
            "macrograph.app/macrograph/utilities",
          );
          assert.strictEqual(span.attributes.get("macrograph.schema.id"), "Print");
          assert.strictEqual(
            span.attributes.get("macrograph.node.id"),
            [whenTrue.id, alsoTrue.id, whenFalse.id][index],
          );
          assert.strictEqual(span.status._tag, "Ended");
        }
      }
    }),
  );
});
