import { describe, expect, it } from "@effect/vitest";
import { CustomTypes, Project } from "@macrograph/core";
import { DataType, Engine, Plugin, Resource } from "@macrograph/plugin";
import { Array, Effect, Option, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("InvalidGraphTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
const typeId = DataType.DefinitionId.make("item");
const type = DataType.Custom(typeId);
const definitions: DataType.Definitions = {
  item: {
    _tag: "Struct",
    id: typeId,
    name: "Item",
    fields: [{ name: "count", type: DataType.Int }],
  },
};
const node = (
  id: string,
  schema: string,
  inputDefaults: Readonly<Record<string, unknown>> = {},
  packageId = "gate-test",
) => ({
  id,
  name: id,
  schema: { package: packageId, schema },
  inputDefaults,
  properties: {},
  foldPins: false,
  position: { x: 0, y: 0 },
});
const wire = (
  id: string,
  outNodeId: string,
  outIoId: string,
  inNodeId: string,
  inIoId: string,
) => ({ id, outNodeId, outIoId, inNodeId, inIoId });

describe("event graph preflight", () => {
  it.effect(
    "blocks stale defaults, missing generated schemas, changed wires and transitive dependencies before side effects",
    () =>
      Effect.gen(function* () {
        let runs = 0;
        let checkpoints = 0;
        const plugin = Plugin.make({
          id: "gate-test",
          engine: TestEngine,
          effect: Effect.fnUntraced(function* (context) {
            yield* context.schema.register({
              id: "event",
              type: "event",
              event: () => Effect.succeed(true),
              io: () => ({}),
              run: () =>
                Effect.sync(() => {
                  runs++;
                }),
            });
            yield* context.schema.register({
              id: "effect",
              io: () => ({}),
              run: () =>
                Effect.sync(() => {
                  runs++;
                }),
            });
            yield* context.schema.register({
              id: "sink",
              io: (io) => ({ value: io.data.in("value", type) }),
              run: () =>
                Effect.sync(() => {
                  runs++;
                }),
            });
            yield* context.schema.register({
              id: "int",
              io: (io) => ({ value: io.data.in("value", DataType.Int) }),
              run: () =>
                Effect.sync(() => {
                  runs++;
                }),
            });
            yield* context.schema.register({
              id: "cycle",
              io: (io) => ({ alternate: io.exec.in("alternate") }),
              run: () =>
                Effect.sync(() => {
                  runs++;
                }),
            });
            yield* context.schema.register({
              id: "pure-cycle",
              type: "pure",
              io: (io) => ({ value: io.data.in("value", type), out: io.data.out("value", type) }),
              run: ({ io }) => Effect.sync(() => io.out(io.value)),
            });
          }),
        });
        const make = [...CustomTypes.schemas(definitions).values()].find(
          (schema) => schema.name === "Make Item",
        )!;
        const base = {
          id: "g",
          name: "Graph",
          nodes: {
            event: node("event", "event"),
            effect: node("effect", "effect"),
            sink: node("sink", "sink", { value: { _type: typeId, count: 1 } }),
          },
          connections: [
            wire("first", "event", "exec", "effect", "exec"),
            wire("last", "effect", "exec", "sink", "exec"),
          ],
        };
        const variants = [
          { types: {}, graph: base, tag: "InvalidGraph" },
          {
            types: definitions,
            graph: {
              ...base,
              nodes: {
                ...base.nodes,
                sink: node("sink", "sink", { value: { _type: typeId, count: 1, obsolete: true } }),
              },
            },
            tag: "InvalidInputValue",
          },
          {
            types: definitions,
            graph: {
              ...base,
              nodes: {
                ...base.nodes,
                sink: node("sink", "sink", { value: { _type: typeId, count: 1 }, removed: 5 }),
              },
            },
            tag: "InvalidInputValue",
          },
          {
            types: definitions,
            graph: {
              ...base,
              nodes: {
                ...base.nodes,
                source: node("source", "deleted-generated", {}, CustomTypes.packageId),
                sink: node("sink", "sink"),
              },
              connections: [...base.connections, wire("data", "source", "value", "sink", "value")],
            },
            tag: "SchemaNotRegistered",
          },
          {
            types: definitions,
            graph: {
              ...base,
              nodes: {
                ...base.nodes,
                source: node("source", make.id, { 'field:"count"': 1 }, CustomTypes.packageId),
                sink: node("sink", "int"),
              },
              connections: [...base.connections, wire("data", "source", "value", "sink", "value")],
            },
            tag: "InvalidConnection",
          },
          {
            types: {
              item: {
                _tag: "Struct",
                id: typeId,
                name: "Item",
                fields: [
                  {
                    name: "child",
                    type: DataType.Option(DataType.Custom(DataType.DefinitionId.make("deleted"))),
                  },
                ],
              },
            },
            graph: base,
            tag: "InvalidGraph",
          },
          {
            types: definitions,
            graph: {
              ...base,
              connections: [
                ...base.connections,
                wire("stale-exec", "effect", "removed", "sink", "exec"),
              ],
            },
            tag: "InvalidConnection",
          },
          {
            types: definitions,
            graph: { ...base, nodes: { ...base.nodes, sink: node("sink", "sink") } },
            tag: "MissingInput",
          },
          {
            types: definitions,
            graph: {
              ...base,
              connections: [...base.connections, wire("cycle", "sink", "exec", "event", "exec")],
            },
            tag: "InvalidConnection",
          },
          {
            types: definitions,
            graph: {
              ...base,
              nodes: { ...base.nodes, effect: node("effect", "cycle") },
              connections: [
                ...base.connections,
                wire("cycle", "sink", "exec", "effect", "alternate"),
              ],
            },
            tag: "ExecutionCycle",
          },
          {
            types: definitions,
            graph: {
              ...base,
              nodes: { ...base.nodes, a: node("a", "pure-cycle"), b: node("b", "pure-cycle") },
              connections: [
                ...base.connections,
                wire("a", "a", "value", "b", "value"),
                wire("b", "b", "value", "a", "value"),
                wire("sink-data", "a", "value", "sink", "value"),
              ],
            },
            tag: "ExecutionCycle",
          },
        ];
        for (const variant of variants) {
          const project = yield* Schema.decodeUnknownEffect(Project.Model)({
            ...Project.empty(),
            types: variant.types,
            graphs: { g: variant.graph },
          });
          const executor = yield* Executor.make(project, {
            executionDriver: {
              executeNode: (_key, effect) =>
                Effect.sync(() => {
                  checkpoints++;
                }).pipe(Effect.andThen(effect)),
            },
          });
          yield* executor.plugin(
            plugin,
            Engine.deployment(
              plugin,
              TestEngine.toLayer(() => Effect.die("Not hosted")),
            ),
          );
          const error = yield* Effect.flip(executor.handleEvent(plugin, new Trigger({})));
          expect(error._tag).toBe(variant.tag);
          expect(runs).toBe(0);
          expect(checkpoints).toBe(0);
        }
      }),
  );

  it.effect("ignores unused invalid definitions, disconnected nodes and unrelated graphs", () =>
    Effect.gen(function* () {
      let runs = 0;
      const plugin = Plugin.make({
        id: "gate-test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: () => ({}),
            run: () =>
              Effect.sync(() => {
                runs++;
              }),
          });
        }),
      });
      const unusedId = DataType.DefinitionId.make("unused");
      const project = yield* Schema.decodeUnknownEffect(Project.Model)({
        ...Project.empty(),
        types: {
          unused: {
            _tag: "Struct",
            id: unusedId,
            name: "Unused",
            fields: [
              { name: "missing", type: DataType.Custom(DataType.DefinitionId.make("missing")) },
            ],
          },
        },
        graphs: {
          g: {
            id: "g",
            name: "Valid",
            nodes: { event: node("event", "event"), disconnected: node("disconnected", "deleted") },
            connections: [],
          },
          other: {
            id: "other",
            name: "Unrelated",
            nodes: { invalid: node("invalid", "deleted", {}, CustomTypes.packageId) },
            connections: [],
          },
        },
      });
      const executor = yield* Executor.make(project);
      yield* executor.plugin(
        plugin,
        Engine.deployment(
          plugin,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(plugin, new Trigger({}));
      expect(runs).toBe(1);
    }),
  );

  it.effect("rejects replayed outputs using the current nominal registry without defects", () =>
    Effect.gen(function* () {
      const plugin = Plugin.make({
        id: "gate-test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: (io) => ({ value: io.data.out("value", type) }),
            run: () => Effect.die("Replay must skip run"),
          });
        }),
      });
      const project = yield* Schema.decodeUnknownEffect(Project.Model)({
        ...Project.empty(),
        types: definitions,
        graphs: {
          g: { id: "g", name: "Graph", nodes: { event: node("event", "event") }, connections: [] },
        },
      });
      for (const value of [
        { _type: "other", count: 1 },
        { _type: typeId, count: "old type" },
        { _type: typeId, count: 1, removed: true },
      ]) {
        const executor = yield* Executor.make(project, {
          executionDriver: {
            executeNode: () =>
              Effect.succeed({
                outputs: [{ outputId: "value", value }],
                executionOutputId: "exec",
              }),
          },
        });
        yield* executor.plugin(
          plugin,
          Engine.deployment(
            plugin,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        expect((yield* Effect.flip(executor.handleEvent(plugin, new Trigger({}))))._tag).toBe(
          "InvalidOutputValue",
        );
      }
    }),
  );

  it.effect("uses persisted resources for event matching and preflight before live lookups", () =>
    Effect.gen(function* () {
      class Selector extends Resource.make<Selector, string>()("selector", { name: "Selector" }) {}
      class ResourceEngine extends Engine.make({
        resources: [Selector],
        events: Array.empty<Trigger>(),
      }) {}
      let runs = 0;
      let lookups = 0;
      const plugin = Plugin.make({
        id: "gate-test",
        engine: ResourceEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            properties: { selector: { name: "Selector", resource: Selector } },
            event: (_event, { properties }) =>
              Effect.succeed(properties.selector === "selected-port"),
            io: () => ({}),
            run: () =>
              Effect.sync(() => {
                runs++;
              }),
          });
          yield* context.schema.register({
            id: "resource",
            properties: { selector: { name: "Selector", resource: Selector } },
            io: (io, properties) => ({ value: io.data.in(properties.selector, DataType.Int) }),
            run: ({ io }) =>
              Effect.sync(() => {
                runs += io.value;
              }),
          });
        }),
      });
      const project = yield* Schema.decodeUnknownEffect(Project.Model)({
        ...Project.empty(),
        constants: {
          selector: {
            id: "selector",
            name: "Selected port",
            resource: { package: plugin.id, resource: "selector" },
            value: "selected-port",
          },
        },
        graphs: {
          g: {
            id: "g",
            name: "Graph",
            nodes: {
              event: { ...node("event", "event"), properties: { selector: "selector" } },
              resource: {
                ...node("resource", "resource", { "selected-port": 2 }),
                properties: { selector: "selector" },
              },
            },
            connections: [wire("exec", "event", "exec", "resource", "exec")],
          },
        },
      });
      const executor = yield* Executor.make(project, {
        engineClient: () => Effect.succeed({}),
        resourceValues: () =>
          Effect.sync(() => {
            lookups++;
            return [{ id: "selected-port", display: "Selected" }];
          }),
      });
      yield* executor.plugin(
        plugin,
        Engine.deployment(
          plugin,
          ResourceEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(plugin, new Trigger({}));
      expect(runs).toBe(3);
      expect(lookups).toBeGreaterThan(0);
      runs = 0;
      lookups = 0;
      const graph = project.graphs.g!;
      yield* executor.loadProject({
        ...project,
        graphs: {
          g: {
            ...graph,
            nodes: {
              ...graph.nodes,
              resource: { ...graph.nodes.resource!, inputDefaults: { "selected-port": "invalid" } },
            },
          },
        },
      });
      expect((yield* Effect.flip(executor.handleEvent(plugin, new Trigger({}))))._tag).toBe(
        "InvalidInputValue",
      );
      expect(runs).toBe(0);
      expect(lookups).toBe(0);
    }),
  );

  it.effect(
    "rejects cyclic live custom values as typed output errors for pure and checkpointed nodes",
    () =>
      Effect.gen(function* () {
        const recursive: DataType.Definitions = {
          item: {
            _tag: "Struct",
            id: typeId,
            name: "Item",
            fields: [{ name: "next", type: DataType.Option(type) }],
          },
        };
        const cyclic: { _type: string; next: Option.Option<unknown> } = {
          _type: typeId,
          next: Option.none(),
        };
        cyclic.next = Option.some(cyclic);
        for (const pure of [false, true]) {
          const plugin = Plugin.make({
            id: "gate-test",
            engine: TestEngine,
            effect: Effect.fnUntraced(function* (context) {
              yield* context.schema.register({
                id: "event",
                type: "event",
                event: () => Effect.succeed(true),
                io: (io) => (pure ? {} : { value: io.data.out("value", type) }),
                run: ({ io }) =>
                  Effect.sync(() => {
                    io.value?.(cyclic);
                  }),
              });
              yield* context.schema.register({
                id: "pure",
                type: "pure",
                io: (io) => ({ value: io.data.out("value", type) }),
                run: ({ io }) => Effect.sync(() => io.value(cyclic)),
              });
              yield* context.schema.register({
                id: "sink",
                io: (io) => ({ value: io.data.in("value", type) }),
                run: () => Effect.die("Invalid output must not reach sink"),
              });
            }),
          });
          const project = yield* Schema.decodeUnknownEffect(Project.Model)({
            ...Project.empty(),
            types: recursive,
            graphs: {
              g: {
                id: "g",
                name: "Graph",
                nodes: {
                  event: node("event", "event"),
                  pure: node("pure", "pure"),
                  sink: node("sink", "sink"),
                },
                connections: [
                  wire("exec", "event", "exec", "sink", "exec"),
                  wire("data", pure ? "pure" : "event", "value", "sink", "value"),
                ],
              },
            },
          });
          const executor = yield* Executor.make(project);
          yield* executor.plugin(
            plugin,
            Engine.deployment(
              plugin,
              TestEngine.toLayer(() => Effect.die("Not hosted")),
            ),
          );
          expect((yield* Effect.flip(executor.handleEvent(plugin, new Trigger({}))))._tag).toBe(
            "InvalidOutputValue",
          );
        }
      }),
  );
});
