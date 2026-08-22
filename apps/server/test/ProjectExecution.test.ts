import { assert, describe, it } from "@effect/vitest";
import {
  Editor,
  EditorEventProjector,
  EditorEvents,
  Packages,
  ProjectPubSub,
} from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import KofiPlugin from "@macrograph/plugin-kofi";
import KofiDeployment from "@macrograph/plugin-kofi/Deployment/Webhook";
import OBSPlugin from "@macrograph/plugin-obs";
import OBSDeployment from "@macrograph/plugin-obs/Deployment/WebSocket";
import TwitchPlugin from "@macrograph/plugin-twitch";
import TwitchDeployment from "@macrograph/plugin-twitch/Deployment/WebSocket";
import { Effect, Layer } from "effect";

import { ProjectExecution } from "../src/ProjectExecution.ts";

const EditorEventsLayer = EditorEvents.layer.pipe(
  Layer.provideMerge(EditorEventProjector.layer),
  Layer.provideMerge(ProjectPubSub.defaultLayer),
);

const EditorLayer = Editor.layer.pipe(
  Layer.provideMerge(EditorEventsLayer),
  Layer.provideMerge(Packages.defaultLayer),
);

const TestLayer = ProjectExecution.layer.pipe(
  Layer.provideMerge(EditorLayer),
  Layer.provide(Persistence.layerMemory),
);

describe("ProjectExecution", () => {
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
          editor.plugin(KofiPlugin, KofiDeployment),
          executor.plugin(KofiPlugin, KofiDeployment),
        ],
        { discard: true },
      );

      assert.deepStrictEqual((yield* packages.getPackages()).map((pkg) => pkg.id).sort(), [
        "kofi",
        "obs",
        "twitch",
      ]);

      const created = yield* editor.graph.create({ name: "Live" });
      yield* editor.engine.setState("twitch", {
        accounts: { streamer: { subscriptions: ["channel.ban"] } },
      });
      yield* editor.engine.setState("obs", {
        sockets: {
          "ws://localhost:4455": { connectOnStartup: false },
        },
      });
      yield* Effect.yieldNow;

      const project = yield* executor.project;
      assert.strictEqual(project.graphs[created.graph.id]?.name, "Live");
      assert.deepStrictEqual(project.engines.twitch, {
        accounts: { streamer: { subscriptions: ["channel.ban"] } },
      });
      assert.deepStrictEqual(project.engines.obs, {
        sockets: {
          "ws://localhost:4455": { connectOnStartup: false },
        },
      });
    }).pipe(Effect.provide(TestLayer)),
  );
});
