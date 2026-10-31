import { expect, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Engine, Module, ModuleId } from "@macrograph/module";
import { Array, Effect, Exit, Schema, Scope } from "effect";

import { Executor } from "../src/index.ts";

class Fire extends Schema.TaggedClass<Fire>()("LifecycleFire", {}) {}
class SourceEngine extends Engine.make({ events: Array.empty<Fire>() }) {}

const sourceId = ModuleId.Id.make("local/test/lifecycle-source");
const sinkId = ModuleId.Id.make("local/test/lifecycle-sink");

const Source = Module.identify(
  sourceId,
  Module.make({
    engine: SourceEngine,
    effect: (context) =>
      context.schema.register({
        id: "fire",
        type: "event",
        event: () => Effect.succeed(true),
        io: () => ({}),
        run: () => Effect.void,
      }),
  }),
);
const SourceDeployment = Engine.identify(
  sourceId,
  Engine.deployment(
    Source,
    SourceEngine.toLayer(() => Effect.die("Source engine is not hosted")),
  ),
);
const makeSink = (ran: Array<string>) =>
  Module.identify(
    sinkId,
    Module.make({
      effect: (context) =>
        context.schema.register({
          id: "record",
          io: () => ({}),
          run: () => Effect.sync(() => void ran.push("record")),
        }),
    }),
  );

const node = (id: string, packageId: string, schema: string) => ({
  id,
  name: id,
  schema: { package: packageId, schema },
  properties: {},
  inputDefaults: {},
  position: { x: 0, y: 0 },
  foldPins: false,
});

const project = Schema.decodeUnknownSync(Project.Model)({
  ...Project.empty(),
  graphs: {
    graph: {
      canvas: {
        id: "graph",
        name: "Graph",
        nodes: {
          fire: node("fire", sourceId, "fire"),
          record: node("record", sinkId, "record"),
        },
        connections: [
          {
            id: "wire",
            outNodeId: "fire",
            outIo: { _tag: "Port", id: "exec" },
            inNodeId: "record",
            inIoId: "exec",
          },
        ],
      },
    },
  },
});

it.effect("fails placeholder nodes with ModuleUnavailable until their module is registered", () =>
  Effect.gen(function* () {
    const ran: Array<string> = [];
    const executor = yield* Executor.make(project);
    yield* executor.module(Source, SourceDeployment);

    const missing = yield* Effect.flip(executor.handleEvent(Source, new Fire()));
    expect(missing).toBeInstanceOf(Executor.ModuleUnavailable);
    expect(missing._tag === "ModuleUnavailable" ? missing.moduleId : undefined).toBe(sinkId);
    expect(ran).toEqual([]);

    const scope = yield* Scope.make();
    yield* executor.module(makeSink(ran)).pipe(Scope.provide(scope));
    yield* executor.handleEvent(Source, new Fire());
    expect(ran).toEqual(["record"]);

    // Unregistering restores the previous state: the sink is a placeholder again.
    yield* Scope.close(scope, Exit.void);
    expect((yield* Effect.flip(executor.handleEvent(Source, new Fire())))._tag).toBe(
      "ModuleUnavailable",
    );
    expect(ran).toEqual(["record"]);

    // The same id can be registered again after removal.
    yield* executor.module(makeSink(ran));
    yield* executor.handleEvent(Source, new Fire());
    expect(ran).toEqual(["record", "record"]);
  }),
);

it.effect("rejects registering a module id twice", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.make(Project.empty());
    yield* executor.module(makeSink([]));
    expect(Exit.isFailure(yield* Effect.exit(executor.module(makeSink([]))))).toBe(true);
  }),
);
