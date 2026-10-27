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
import { t, Engine, Module, ModuleId } from "@macrograph/module";
import ListModuleDefinition from "@macrograph/module-list";
import StringModuleDefinition from "@macrograph/module-string";
import { Array, Effect, Fiber, Layer, Option, Schema } from "effect";
import { RpcGroup } from "effect/rpc";
import { TestClock } from "effect/testing";

import LogicModuleDefinition from "../src/Module.ts";

const LogicModule = Module.identify(Module.builtinId("logic"), LogicModuleDefinition);

const ListModule = Module.identify(Module.builtinId("list"), ListModuleDefinition);
const StringModule = Module.identify(Module.builtinId("string"), StringModuleDefinition);

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
  outIo: { _tag: "Port" as const, id: IoId.make(output) },
  inNodeId: NodeId.make(input),
  inIoId: IoId.make(pin),
});

describe("Logic execution", () => {
  it.effect(
    "evaluates ListLength and IsOptionNone using connected type anchors, and JoinLines defaults",
    () =>
      Effect.gen(function* () {
        const results: Array<{
          readonly length: number;
          readonly none: boolean;
          readonly lines: string;
        }> = [];
        const source = Module.identify(
          ModuleId.Id.make("local/test/test-source"),
          Module.make({
            engine: SourceEngine,
            effect: Effect.fnUntraced(function* (context) {
              yield* context.schema.register({
                id: "Start",
                type: "event",
                event: () => Effect.succeed(true),
                io: (io) => ({
                  list: io.data.out("list", t.List(t.String)),
                  option: io.data.out("option", t.Option(t.String)),
                }),
                run: ({ io }) =>
                  Effect.sync(() => {
                    io.list([]);
                    io.option(Option.none());
                  }),
              });
              yield* context.schema.register({
                id: "Sink",
                io: (io) => ({
                  length: io.data.in("length", t.Int),
                  none: io.data.in("none", t.Bool),
                  lines: io.data.in("lines", t.String),
                }),
                run: ({ io }) =>
                  Effect.sync(() => {
                    results.push(io);
                  }),
              });
            }),
          }),
        );
        const sourceDeployment = Engine.identify(
          source.id,
          Engine.deployment(
            source,
            SourceEngine.toLayer(() =>
              Effect.succeed({
                resources: Layer.empty,
                rpcs: Layer.empty,
                client: { state: Effect.succeed(null), rpcs: Layer.empty },
              }),
            ),
          ),
        );
        const graphId = GraphId.make("defaults");
        const nodes = [
          node("start", source.id, "Start"),
          node("sink", source.id, "Sink"),
          node("length", "macrograph.app/macrograph/list", "ListLength"),
          node("none", "macrograph.app/macrograph/logic", "IsOptionNone"),
          node("lines", "macrograph.app/macrograph/string", "JoinLines"),
        ];
        for (const item of nodes) assert.deepStrictEqual(item.inputDefaults, {});
        const project: Project.Model = {
          name: "Defaults",
          functions: {},
          engines: {},
          constants: {},
          types: {},
          queues: {},
          graphs: {
            [graphId]: {
              canvas: {
                id: graphId,
                name: "Defaults",
                nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
                connections: [
                  connect("start-sink", "start", "exec", "sink", "exec"),
                  connect("list-anchor", "start", "list", "length", "list"),
                  connect("option-anchor", "start", "option", "none", "input"),
                  connect("length-sink", "length", "output", "sink", "length"),
                  connect("none-sink", "none", "output", "sink", "none"),
                  connect("lines-sink", "lines", "output", "sink", "lines"),
                ],
              },
            },
          },
        };
        const executor = yield* Executor.make(project);
        yield* executor.module(source, sourceDeployment);
        yield* executor.module(LogicModule);
        yield* executor.module(ListModule);
        yield* executor.module(StringModule);
        yield* executor.handleEvent(source, new Start({}));
        assert.deepStrictEqual(results, [{ length: 0, none: true, lines: "" }]);
      }),
  );
  it.effect(
    "waits before continuing, evaluates typed pure nodes, and follows only the selected branch",
    () =>
      Effect.gen(function* () {
        const messages: Array<string> = [];
        const source = Module.identify(
          ModuleId.Id.make("local/test/test-source"),
          Module.make({
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
                io: (io) => ({ input: io.data.in("input", t.String) }),
                run: ({ io }) =>
                  Effect.sync(() => {
                    messages.push(io.input);
                  }),
              });
            }),
          }),
        );
        const sourceDeployment = Engine.identify(
          source.id,
          Engine.deployment(
            source,
            SourceEngine.toLayer(() =>
              Effect.succeed({
                resources: Layer.empty,
                rpcs: Layer.empty,
                client: { state: Effect.succeed(null), rpcs: Layer.empty },
              }),
            ),
          ),
        );
        const graphId = GraphId.make("logic");
        const invert = node("invert", "macrograph.app/macrograph/logic", "NOT", { input: false });
        const nodes = [
          node("start", "local/test/test-source", "Start"),
          node("wait", "macrograph.app/macrograph/logic", "Wait", { delay: 20 }),
          node("branch", "macrograph.app/macrograph/logic", "Branch"),
          invert,
          node("conditional", "macrograph.app/macrograph/logic", "Conditional", {
            condition: true,
            trueValue: "selected",
            falseValue: "unselected",
          }),
          node("true", "local/test/test-source", "Sink"),
          node("false", "local/test/test-source", "Sink", { input: "false branch" }),
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
            connect("conditional-sink", "conditional", "output", "true", "input"),
          ],
        };
        const project: Project.Model = {
          name: "Logic",
          functions: {},
          engines: {},
          constants: {},
          types: {},
          queues: {},
          graphs: { [graphId]: { canvas: graph } },
        };
        const executor = yield* Executor.make(project);
        yield* executor.module(source, sourceDeployment);
        yield* executor.module(LogicModule);
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
              canvas: {
                ...graph,
                nodes: {
                  ...graph.nodes,
                  [invert.id]: { ...invert, inputDefaults: { input: true } },
                },
              },
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
