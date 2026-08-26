import { assert, describe, it } from "@effect/vitest";
import { PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { DrizzleDriver, SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Engine, Plugin } from "@macrograph/plugin";
import OBSPlugin from "@macrograph/plugin-obs";
import { OBSEngine } from "@macrograph/plugin-obs/Definition";
import OBSDeployment from "@macrograph/plugin-obs/Deployment/WebSocket";
import TwitchPlugin from "@macrograph/plugin-twitch";
import TwitchDeployment from "@macrograph/plugin-twitch/Deployment/WebSocket";
import { Array, Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
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
  it.effect("captures events and driver nodes using the shared runtime activity service", () =>
    Effect.gen(function* () {
      class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {}) {}
      class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
      let nodeEffect: Effect.Effect<void, Error> = Effect.void;
      const plugin = Plugin.make({
        id: "activity-test",
        engine: TestEngine,
        effect: (registration) =>
          registration.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: () => ({}),
            run: () => nodeEffect,
          }),
      });
      const deployment = Engine.deployment(
        plugin,
        TestEngine.toLayer(() => Effect.die("unused")),
      );
      const editor = yield* Editor.Service;
      const executor = yield* ProjectExecution.Service;
      const activity = yield* RuntimeActivity.Service;
      yield* editor.plugin(plugin, deployment);
      yield* executor.plugin(plugin, deployment);
      const { graph } = yield* editor.graph.create({ name: "Activity" });
      const created = yield* editor.node.create({
        graphID: graph.id,
        node: {
          schema: { package: PackageId.make(plugin.id), schema: SchemaId.make("event") },
          position: { x: 0, y: 0 },
        },
      });
      yield* Effect.yieldNow;
      yield* executor.handleEvent(plugin, new Trigger({}));
      const event = (yield* activity.snapshot)[0]!;
      assert.strictEqual(event.name, "Trigger");
      assert.strictEqual(event.status, "complete");
      assert.lengthOf(event.nodes, 1);
      assert.strictEqual(event.nodes[0]?.nodeId, created.node.id);
      assert.strictEqual(event.nodes[0]?.graphId, graph.id);
      assert.strictEqual(event.nodes[0]?.status, "complete");

      nodeEffect = Effect.fail(new Error("node failed"));
      assert.isTrue(
        Exit.isFailure(yield* executor.handleEvent(plugin, new Trigger({})).pipe(Effect.exit)),
      );
      assert.strictEqual((yield* activity.snapshot)[0]?.status, "failed");
      assert.strictEqual((yield* activity.snapshot)[0]?.nodes[0]?.status, "failed");

      const started = yield* Deferred.make<void>();
      nodeEffect = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
      const fiber = yield* executor.handleEvent(plugin, new Trigger({})).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(fiber)));
      assert.strictEqual((yield* activity.snapshot)[0]?.status, "interrupted");
      assert.strictEqual((yield* activity.snapshot)[0]?.nodes[0]?.status, "interrupted");
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
          editor.plugin(TwitchPlugin, TwitchDeployment),
          executor.plugin(TwitchPlugin, TwitchDeployment),
          editor.plugin(OBSPlugin, OBSDeployment),
          executor.plugin(OBSPlugin, OBSDeployment),
        ],
        { discard: true },
      );

      assert.deepStrictEqual((yield* packages.getPackages()).map((pkg) => pkg.id).sort(), [
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
      assert.strictEqual(project.graphs[created.graph.id]?.name, "Live");
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
});
