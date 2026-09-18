import { assert, describe, it } from "@effect/vitest";
import { GraphId, IoId, PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { DrizzleDriver, SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Engine, Module } from "@macrograph/module";
import OBSModule from "@macrograph/module-obs";
import { OBSEngine } from "@macrograph/module-obs/Definition";
import OBSDeployment from "@macrograph/module-obs/Deployment/WebSocket";
import TwitchModule from "@macrograph/module-twitch";
import TwitchDeployment from "@macrograph/module-twitch/Deployment/WebSocket";
import {
  Array,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectExecution } from "../src/ProjectExecution.ts";

const EditorLayer = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
);

const TestLayer = ProjectExecution.layer.pipe(
  Layer.provideMerge(EditorLayer),
  Layer.provideMerge(RuntimeActivity.layer),
  Layer.provide(Persistence.layerMemory),
);

describe("ProjectExecution", () => {
  it.effect("captures events and driver nodes and replays against current editor state", () =>
    Effect.gen(function* () {
      class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", { message: Schema.String }) {}
      class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
      const input = new Trigger({ message: "x".repeat(20_000) });
      let nodeEffect: Effect.Effect<void, Error> = Effect.void;
      const module = Module.make({
        id: "activity-test",
        engine: TestEngine,
        effect: (registration) =>
          registration.schema.register({
            id: "event",
            type: "event",
            event: (event) => Effect.succeed(event.message === input.message),
            io: () => ({}),
            run: () => nodeEffect,
          }),
      });
      const deployment = Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("unused")),
      );
      const editor = yield* Editor.Service;
      const executor = yield* ProjectExecution.Service;
      const activity = yield* RuntimeActivity.Service;
      yield* editor.module(module, deployment);
      yield* executor.module(module, deployment);
      const { graph } = yield* editor.graph.create({ name: "Activity" });
      const created = yield* editor.node.create({
        graphID: graph.id,
        node: {
          schema: { package: PackageId.make(module.id), schema: SchemaId.make("event") },
          position: { x: 0, y: 0 },
        },
      });
      yield* Effect.yieldNow;
      yield* executor.handleEvent(module, input);
      const event = (yield* activity.snapshot)[0]!;
      assert.strictEqual(event.name, "Trigger");
      assert.strictEqual(event.status, "complete");
      assert.lengthOf(event.nodes, 1);
      assert.strictEqual(event.nodes[0]?.nodeId, created.node.id);
      assert.strictEqual(event.nodes[0]?.graphId, graph.id);
      assert.strictEqual(event.nodes[0]?.status, "complete");

      nodeEffect = Effect.fail(new Error("node failed"));
      assert.isTrue(Exit.isFailure(yield* executor.handleEvent(module, input).pipe(Effect.exit)));
      assert.strictEqual((yield* activity.snapshot)[0]?.status, "failed");
      assert.strictEqual((yield* activity.snapshot)[0]?.nodes[0]?.status, "failed");

      const started = yield* Deferred.make<void>();
      nodeEffect = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
      const fiber = yield* executor.handleEvent(module, input).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(fiber)));
      assert.strictEqual((yield* activity.snapshot)[0]?.status, "interrupted");
      assert.strictEqual((yield* activity.snapshot)[0]?.nodes[0]?.status, "interrupted");

      nodeEffect = Effect.void;
      const added = yield* editor.node.create({
        graphID: graph.id,
        node: {
          schema: { package: PackageId.make(module.id), schema: SchemaId.make("event") },
          position: { x: 100, y: 0 },
        },
      });
      yield* Effect.yieldNow;
      assert.isDefined((yield* executor.project).graphs[graph.id]?.canvas.nodes[added.node.id]);
      yield* activity.replay(event.id);
      const replayed = Option.getOrThrow(
        yield* activity.changes.pipe(
          Stream.filter(
            (events) => events[0]?.source === "Replay" && events[0]?.status === "complete",
          ),
          Stream.runHead,
        ),
      )[0]!;
      assert.notStrictEqual(replayed.id, event.id);
      assert.isTrue(replayed.replayable);
      assert.deepStrictEqual(
        replayed.nodes.map((node) => node.nodeId).sort(),
        [created.node.id, added.node.id].sort(),
      );
      assert.isTrue(replayed.nodes.every((node) => node.status === "complete"));
      assert.lengthOf(event.nodes, 1);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("initializes and follows persisted editor changes", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const packages = yield* Packages.Service;
      const executor = yield* ProjectExecution.Service;

      assert.strictEqual((yield* executor.project).name, "test");

      yield* Effect.all(
        [
          editor.module(TwitchModule, TwitchDeployment),
          executor.module(TwitchModule, TwitchDeployment),
          editor.module(OBSModule, OBSDeployment),
          executor.module(OBSModule, OBSDeployment),
        ],
        { discard: true },
      );

      assert.deepStrictEqual((yield* packages.getPackages()).map((pkg) => pkg.id).sort(), [
        "CustomTypes",
        "Scopes",
        "obs",
        "twitch",
      ]);

      const created = yield* editor.graph.create({ name: "Live" });
      yield* editor.engine.setState("twitch", {
        accounts: { streamer: { subscriptions: ["channel.ban"] } },
      });
      yield* editor.engine.setState("obs", {
        sockets: {
          "ws://localhost:4455": { password: "obs-secret", connectOnStartup: false },
        },
      });
      yield* Effect.yieldNow;

      const project = yield* executor.project;
      assert.strictEqual(project.graphs[created.graph.id]?.canvas.name, "Live");
      assert.deepStrictEqual(project.engines.twitch, {
        accounts: { streamer: { enabled: true, subscriptions: ["channel.ban"] } },
      });
      assert.deepStrictEqual(project.engines.obs, {
        sockets: {
          "ws://localhost:4455": { password: "obs-secret", connectOnStartup: false },
        },
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("persists and decodes OBS passwords through SQLite restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "macrograph-server-obs-"));
    const databasePath = join(directory, "project.db");
    const migrationsDirectory = fileURLToPath(
      new URL("../../../packages/persistence-sqlite/drizzle", import.meta.url),
    );
    const layer = SqlitePersistence.layer.pipe(
      Layer.provide(DrizzleDriver.layerNodeSqlite(databasePath, migrationsDirectory)),
    );
    const project = {
      ...Project.empty(),
      engines: {
        obs: {
          sockets: {
            "ws://localhost:4455": {
              name: "Studio OBS",
              password: "sqlite-secret",
              connectOnStartup: true,
            },
          },
        },
      },
    };

    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(layer);
          yield* Context.get(context, Persistence.Service).saveProject(project);
        }),
      );
      const loaded = yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(layer);
          return yield* Context.get(context, Persistence.Service).loadProject();
        }),
      );
      assert.deepStrictEqual(
        Schema.decodeUnknownSync(OBSEngine.Storage)(loaded.engines.obs),
        project.engines.obs,
      );
    }).pipe(Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true }))));
  });

  it.effect("round-trips function metadata separately from graph nodes", () => {
    const directory = mkdtempSync(join(tmpdir(), "macrograph-server-function-"));
    const databasePath = join(directory, "project.db");
    const migrationsDirectory = fileURLToPath(
      new URL("../../../packages/persistence-sqlite/drizzle", import.meta.url),
    );
    const layer = SqlitePersistence.layer.pipe(
      Layer.provide(DrizzleDriver.layerNodeSqlite(databasePath, migrationsDirectory)),
    );
    const graphId = GraphId.make("format-message");
    const regularGraphId = GraphId.make("main");
    const project: Project.Model = {
      ...Project.empty(),
      graphs: {
        [regularGraphId]: {
          canvas: { id: regularGraphId, name: "Main", nodes: {}, connections: [] },
        },
      },
      functions: {
        [graphId]: {
          canvas: { id: graphId, name: "Format message", nodes: {}, connections: [] },
          arguments: [{ id: IoId.make("message"), name: "Message", type: { _tag: "String" } }],
          returns: [{ id: IoId.make("result"), name: "Result", type: { _tag: "String" } }],
          inputPosition: { x: 100, y: 200 },
          outputPosition: { x: 700, y: 200 },
        },
      },
    };

    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(layer);
          const persistence = Context.get(context, Persistence.Service);
          yield* persistence.saveProject(project);
          yield* persistence.saveGraph({
            ...project.functions[graphId]!.canvas,
            name: "Updated body",
          });
        }),
      );
      const loaded = yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(layer);
          return yield* Context.get(context, Persistence.Service).loadProject();
        }),
      );
      assert.deepStrictEqual(loaded.functions[graphId]?.canvas.nodes, {});
      assert.strictEqual(loaded.functions[graphId]?.canvas.name, "Updated body");
      assert.deepStrictEqual(
        loaded.functions[graphId]?.arguments,
        project.functions[graphId]?.arguments,
      );
      assert.strictEqual(loaded.graphs[regularGraphId]?.canvas.name, "Main");
    }).pipe(Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true }))));
  });
});
