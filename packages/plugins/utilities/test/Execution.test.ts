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
import { Effect, Logger, Schema, Tracer } from "effect";

import { TickEvent } from "../src/Definition.ts";
import UtilitiesDeployment from "../src/Deployment.ts";
import UtilitiesPlugin from "../src/Plugin.ts";

const node = (
  id: string,
  schema: string,
  properties: Readonly<Record<string, Schema.Json>>,
  inputDefaults: Readonly<Record<string, Schema.Json>>,
) => ({
  id: NodeId.make(id),
  name: id,
  schema: { package: PackageId.make("util"), schema: SchemaId.make(schema) },
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
      const branch = node("branch", "Branch", {}, { condition: true });
      const whenTrue = node("true", "Print", {}, { in: "true" });
      const alsoTrue = node("also-true", "Print", {}, { in: "also true" });
      const whenFalse = node("false", "Print", {}, { in: "false" });
      const project: Project.Model = {
        name: "Utilities",
        engines: {},
        constants: {},
        graphs: {
          [graphId]: {
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
                outIoId: IoId.make("exec"),
                inNodeId: branch.id,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("branch-true"),
                outNodeId: branch.id,
                outIoId: IoId.make("trueOut"),
                inNodeId: whenTrue.id,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("branch-false"),
                outNodeId: branch.id,
                outIoId: IoId.make("falseOut"),
                inNodeId: whenFalse.id,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("branch-also-true"),
                outNodeId: branch.id,
                outIoId: IoId.make("trueOut"),
                inNodeId: alsoTrue.id,
                inIoId: IoId.make("exec"),
              },
            ],
          },
        },
      };
      const messages: Array<unknown> = [];
      const printSpans: Array<Tracer.AnySpan | undefined> = [];
      const logger = Logger.make<unknown, void>((options) => {
        messages.push(options.message);
        printSpans.push(options.fiber.currentSpan);
      });
      const executor = yield* Executor.make(project);
      yield* executor.plugin(UtilitiesPlugin, UtilitiesDeployment);

      yield* executor.handleEvent(UtilitiesPlugin, new TickEvent({ tick: 1 }));
      assert.deepStrictEqual(messages, []);
      yield* executor
        .handleEvent(UtilitiesPlugin, new TickEvent({ tick: 2 }))
        .pipe(Effect.provide(Logger.layer([logger])));
      assert.deepStrictEqual(messages, [
        ["Utilities Print", { value: "true" }],
        ["Utilities Print", { value: "also true" }],
      ]);

      yield* executor.loadProject({
        ...project,
        graphs: {
          [graphId]: {
            ...project.graphs[graphId]!,
            nodes: {
              ...project.graphs[graphId]!.nodes,
              [branch.id]: { ...branch, inputDefaults: { condition: false } },
            },
          },
        },
      });
      yield* executor
        .handleEvent(UtilitiesPlugin, new TickEvent({ tick: 4 }))
        .pipe(Effect.provide(Logger.layer([logger])));
      assert.deepStrictEqual(messages, [
        ["Utilities Print", { value: "true" }],
        ["Utilities Print", { value: "also true" }],
        ["Utilities Print", { value: "false" }],
      ]);
      assert.lengthOf(printSpans, 3);
      for (const [index, span] of printSpans.entries()) {
        assert.strictEqual(span?._tag, "Span");
        if (span?._tag === "Span") {
          assert.strictEqual(span.name, "Schema.run util.Print");
          assert.strictEqual(span.attributes.get("macrograph.plugin.id"), "util");
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
