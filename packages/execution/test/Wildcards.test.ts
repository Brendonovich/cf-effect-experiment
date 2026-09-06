import { expect, it } from "@effect/vitest";
import { ConnectionId, IoId, NodeId, OutputRef, Project, SchemaId } from "@macrograph/core";
import { DataType as t, Engine, Module } from "@macrograph/module";
import { Array, DateTime, Effect, Option, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("WildcardTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
const payload = Option.some([DateTime.makeUnsafe("2026-09-05T12:00:00Z")]);
const type = t.Option(t.List(t.DateTime));
const fixture = (captured: unknown[], wrong = false) =>
  Module.make({
    id: "wildcards",
    engine: TestEngine,
    effect: Effect.fnUntraced(function* (context) {
      yield* context.schema.register({
        id: "event",
        type: "event",
        event: () => Effect.succeed(true),
        io: (io) => ({ output: io.data.out("out", type) }),
        run: ({ io }) => Effect.sync(() => io.output(payload)),
      });
      yield* context.schema.register({
        id: "identity",
        io: (io) => {
          const wildcard = io.wildcard("T");
          return { input: io.data.in("in", wildcard), output: io.data.out("out", wildcard) };
        },
        run: ({ io }) => Effect.sync(() => io.output(wrong ? "invalid" : io.input)),
      });
      yield* context.schema.register({
        id: "sink",
        io: (io) => ({ input: io.data.in("in", type) }),
        run: ({ io }) =>
          Effect.sync(() => {
            captured.push(io.input);
          }),
      });
      yield* context.schema.register({
        id: "unresolved",
        type: "event",
        event: () => Effect.succeed(true),
        io: (io) => ({ output: io.data.out("out", io.wildcard("T")) }),
        run: () =>
          Effect.sync(() => {
            captured.push("must not run");
          }),
      });
      yield* context.schema.register({
        id: "stringSink",
        io: (io) => ({ input: io.data.in("in", t.String) }),
        run: () =>
          Effect.sync(() => {
            captured.push("must not run");
          }),
      });
    }),
  });
const project = (unresolved = false) =>
  Schema.decodeUnknownSync(Project.Model)({
    ...Project.empty(),
    graphs: {
      graph: {
        id: "graph",
        name: "Graph",
        nodes: Object.fromEntries(
          (unresolved ? ["unresolved"] : ["event", "identity", "sink"]).map((id) => [
            id,
            {
              id,
              name: id,
              schema: { package: "wildcards", schema: id },
              properties: {},
              inputDefaults: {},
              position: { x: 0, y: 0 },
              foldPins: false,
            },
          ]),
        ),
        connections: unresolved
          ? []
          : [
              ["event", "exec", "identity", "exec"],
              ["identity", "exec", "sink", "exec"],
              ["event", "out", "identity", "in"],
              ["identity", "out", "sink", "in"],
            ].map(([from, out, to, input], i) => ({
              id: String(i),
              outNodeId: from,
              outIo: { _tag: "Port", id: out },
              inNodeId: to,
              inIoId: input,
            })),
      },
    },
  });

it.effect(
  "executes and round-trips inferred nested Option/List/DateTime outputs through the driver",
  () =>
    Effect.gen(function* () {
      const captured: unknown[] = [],
        encoded: unknown[] = [];
      const module = fixture(captured);
      const executor = yield* Executor.make(project(), {
        executionDriver: {
          executeNode: (_key, effect) =>
            effect.pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  encoded.push(result);
                }),
              ),
            ),
        },
      });
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(module, new Trigger({}));
      expect(captured).toEqual([payload]);
      expect(encoded).toHaveLength(3);
      expect(JSON.stringify(encoded)).toContain("2026-09-05T12:00:00.000Z");
    }),
);

it.effect("validates actual wildcard output values against the inferred type", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured, true);
    const executor = yield* Executor.make(project());
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    expect((yield* Effect.flip(executor.handleEvent(module, new Trigger({}))))._tag).toBe(
      "InvalidOutputValue",
    );
    expect(captured).toEqual([]);
  }),
);

it.effect("rejects unresolved wildcard IO before any side effects", () =>
  Effect.gen(function* () {
    const captured: unknown[] = [];
    const module = fixture(captured);
    const executor = yield* Executor.make(project(true));
    yield* executor.module(
      module,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("Not hosted")),
      ),
    );
    const error = yield* Effect.flip(executor.handleEvent(module, new Trigger({})));
    expect(error._tag).toBe("InvalidGraph");
    if (error._tag === "InvalidGraph")
      expect(error.reasons.join(" ")).toContain("Unresolved wildcard");
    expect(captured).toEqual([]);
  }),
);

it.effect(
  "rejects conflicting inference before execution rather than caching an invalid group",
  () =>
    Effect.gen(function* () {
      const captured: unknown[] = [];
      const module = fixture(captured);
      const model = project();
      const graph = model.graphs.graph!;
      const executor = yield* Executor.make({
        ...model,
        graphs: {
          graph: {
            ...graph,
            nodes: {
              ...graph.nodes,
              sink: {
                ...graph.nodes.sink!,
                schema: { ...graph.nodes.sink!.schema, schema: SchemaId.make("stringSink") },
              },
            },
          },
        },
      });
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      const error = yield* Effect.flip(executor.handleEvent(module, new Trigger({})));
      expect(error._tag).toBe("InvalidGraph");
      if (error._tag === "InvalidGraph") expect(error.reasons.join(" ")).toContain("Conflicting");
      expect(captured).toEqual([]);
    }),
);

for (const reached of [false, true])
  it.effect(
    reached
      ? "revalidates an excluded invalid component when preflight reaches it"
      : "executes completed groups even when a separate saved component is invalid",
    () =>
      Effect.gen(function* () {
        const captured: unknown[] = [];
        const module = fixture(captured);
        const model = project();
        const graph = model.graphs.graph!;
        const executor = yield* Executor.make({
          ...model,
          graphs: {
            graph: {
              ...graph,
              nodes: {
                ...graph.nodes,
                detached: { ...graph.nodes.identity!, id: NodeId.make("detached") },
                typed: { ...graph.nodes.sink!, id: NodeId.make("typed") },
                string: {
                  ...graph.nodes.sink!,
                  id: NodeId.make("string"),
                  schema: { ...graph.nodes.sink!.schema, schema: SchemaId.make("stringSink") },
                },
              },
              connections: [
                ...graph.connections,
                ...["typed", "string"].map((target) => ({
                  id: ConnectionId.make(target),
                  outNodeId: "detached",
                  outIo: OutputRef.port("out"),
                  inNodeId: target,
                  inIoId: IoId.make("in"),
                })),
                ...(reached
                  ? [
                      {
                        id: ConnectionId.make("reach"),
                        outNodeId: "sink",
                        outIo: OutputRef.port("exec"),
                        inNodeId: "detached",
                        inIoId: IoId.make("exec"),
                      },
                    ]
                  : []),
              ],
            },
          },
        });
        yield* executor.module(
          module,
          Engine.deployment(
            module,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        if (reached) {
          const error = yield* Effect.flip(executor.handleEvent(module, new Trigger({})));
          expect(error._tag).toBe("InvalidGraph");
          if (error._tag === "InvalidGraph")
            expect(error.reasons.join(" ")).toContain("Conflicting");
          expect(captured).toEqual([]);
        } else {
          yield* executor.handleEvent(module, new Trigger({}));
          expect(captured).toEqual([payload]);
        }
      }),
  );
