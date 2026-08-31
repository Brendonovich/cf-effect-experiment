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
import { DataType, Engine, Plugin } from "@macrograph/plugin";
import ListPlugin from "@macrograph/plugin-list";
import StringPlugin from "@macrograph/plugin-string";
import { Array, Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { RpcGroup } from "effect/unstable/rpc";

import LogicPlugin from "../src/Plugin.ts";

class Start extends Schema.TaggedClass<Start>()("Start", {}) {}
class SourceEngine extends Engine.make({
  events: Array.empty<Start>(),
  client: { state: Schema.Null, rpcs: RpcGroup.make() },
}) {}

const node = (
  id: string,
  pkg: string,
  schema: string,
  inputDefaults: Readonly<Record<string, Schema.Json>> = {},
  properties: Readonly<Record<string, Schema.Json>> = {},
) => ({
  id: NodeId.make(id),
  name: id,
  schema: { package: PackageId.make(pkg), schema: SchemaId.make(schema) },
  properties,
  inputDefaults,
  foldPins: false,
  position: { x: 0, y: 0 },
});
const connect = (id: string, out: string, output: string, input: string, pin: string) => ({
  id: ConnectionId.make(id),
  outNodeId: NodeId.make(out),
  outIoId: IoId.make(output),
  inNodeId: NodeId.make(input),
  inIoId: IoId.make(pin),
});

describe("Logic execution", () => {
  it.effect(
    "evaluates empty ListLength, IsOptionNone, and JoinLines nodes with empty inputDefaults",
    () =>
      Effect.gen(function* () {
        const results: Array<{
          readonly length: number;
          readonly none: boolean;
          readonly lines: string;
        }> = [];
        const source = Plugin.make({
          id: "test-source",
          engine: SourceEngine,
          effect: Effect.fnUntraced(function* (context) {
            yield* context.schema.register({
              id: "Start",
              type: "event",
              event: () => Effect.succeed(true),
              io: () => ({}),
              run: () => Effect.void,
            });
            yield* context.schema.register({
              id: "Sink",
              io: (io) => ({
                length: io.data.in("length", DataType.Int),
                none: io.data.in("none", DataType.Bool),
                lines: io.data.in("lines", DataType.String),
              }),
              run: ({ io }) =>
                Effect.sync(() => {
                  results.push(io);
                }),
            });
          }),
        });
        const sourceDeployment = Engine.deployment(
          source,
          SourceEngine.toLayer(() =>
            Effect.succeed({
              resources: Layer.empty,
              rpcs: Layer.empty,
              client: { state: Effect.succeed(null), rpcs: Layer.empty },
            }),
          ),
        );
        const graphId = GraphId.make("defaults");
        const nodes = [
          node("start", source.id, "Start"),
          node("sink", source.id, "Sink"),
          node("length", "list", "ListLength"),
          node("none", "logic", "IsOptionNone"),
          node("lines", "string", "JoinLines"),
        ];
        for (const item of nodes) assert.deepStrictEqual(item.inputDefaults, {});
        const project: Project.Model = {
          name: "Defaults",
          engines: {},
          customEvents: {},
          constants: {},
          graphs: {
            [graphId]: {
              id: graphId,
              name: "Defaults",
              nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
              connections: [
                connect("start-sink", "start", "exec", "sink", "exec"),
                connect("length-sink", "length", "output", "sink", "length"),
                connect("none-sink", "none", "output", "sink", "none"),
                connect("lines-sink", "lines", "output", "sink", "lines"),
              ],
            },
          },
        };
        const executor = yield* Executor.make(project);
        yield* executor.plugin(source, sourceDeployment);
        yield* executor.plugin(LogicPlugin);
        yield* executor.plugin(ListPlugin);
        yield* executor.plugin(StringPlugin);
        yield* executor.handleEvent(source, new Start({}));
        assert.deepStrictEqual(results, [{ length: 0, none: true, lines: "" }]);
      }),
  );
  it.effect(
    "waits before continuing, evaluates typed pure nodes, and follows only the selected branch",
    () =>
      Effect.gen(function* () {
        const messages: Array<string> = [];
        const source = Plugin.make({
          id: "test-source",
          engine: SourceEngine,
          effect: Effect.fnUntraced(function* (context) {
            yield* context.schema.register({
              id: "Start",
              type: "event",
              event: () => Effect.succeed(true),
              io: () => ({}),
              run: () => Effect.void,
            });
            yield* context.schema.register({
              id: "Sink",
              io: (io) => ({ input: io.data.in("input", DataType.String) }),
              run: ({ io }) =>
                Effect.sync(() => {
                  messages.push(io.input);
                }),
            });
          }),
        });
        const sourceDeployment = Engine.deployment(
          source,
          SourceEngine.toLayer(() =>
            Effect.succeed({
              resources: Layer.empty,
              rpcs: Layer.empty,
              client: { state: Effect.succeed(null), rpcs: Layer.empty },
            }),
          ),
        );
        const graphId = GraphId.make("logic");
        const invert = node("invert", "logic", "NOT", { input: false });
        const nodes = [
          node("start", "test-source", "Start"),
          node("wait", "logic", "Wait", { delay: 20 }),
          node("branch", "logic", "Branch"),
          invert,
          node(
            "conditional",
            "logic",
            "Conditional",
            { condition: true, trueValue: "selected", falseValue: "unselected" },
            { type: "String" },
          ),
          node("true", "test-source", "Sink"),
          node("false", "test-source", "Sink", { input: "false branch" }),
          node("default", "test-source", "Sink", { input: "default must not run" }),
        ];
        const graph = {
          id: graphId,
          name: "Logic",
          nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
          connections: [
            connect("start-wait", "start", "exec", "wait", "exec"),
            connect("wait-branch", "wait", "exec", "branch", "exec"),
            connect("condition", "invert", "output", "branch", "condition"),
            connect("branch-true", "branch", "true", "true", "exec"),
            connect("branch-false", "branch", "false", "false", "exec"),
            connect("branch-default", "branch", "exec", "default", "exec"),
            connect("conditional-sink", "conditional", "output", "true", "input"),
          ],
        };
        const project: Project.Model = {
          name: "Logic",
          engines: {},
          customEvents: {},
          constants: {},
          graphs: { [graphId]: graph },
        };
        const executor = yield* Executor.make(project);
        yield* executor.plugin(source, sourceDeployment);
        yield* executor.plugin(LogicPlugin);
        const first = yield* executor.handleEvent(source, new Start({})).pipe(Effect.forkChild);
        yield* TestClock.adjust(19);
        assert.deepStrictEqual(messages, []);
        yield* TestClock.adjust(1);
        yield* Fiber.join(first);
        assert.deepStrictEqual(messages, ["selected"]);
        yield* executor.loadProject({
          ...project,
          graphs: {
            [graphId]: {
              ...graph,
              nodes: { ...graph.nodes, [invert.id]: { ...invert, inputDefaults: { input: true } } },
            },
          },
        });
        const second = yield* executor.handleEvent(source, new Start({})).pipe(Effect.forkChild);
        yield* TestClock.adjust(20);
        yield* Fiber.join(second);
        assert.deepStrictEqual(messages, ["selected", "false branch"]);
      }),
  );
});
