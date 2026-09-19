import { assert, describe, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";

import { LiveRuntime } from "../src/index.ts";

const EditorLayer = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
);

const TestLayer = LiveRuntime.layer({
  projectId: "live-test",
  initialProject: { ...Project.empty(), name: "Live test" },
}).pipe(
  Layer.provideMerge(EditorLayer),
  Layer.provideMerge(RuntimeActivity.layer),
  Layer.provide(Persistence.layerMemory),
);

describe("LiveRuntime", () => {
  it.effect("initializes and follows persisted editor changes", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const executor = yield* LiveRuntime.Service;

      assert.strictEqual((yield* executor.project).name, "Live test");
      const created = yield* editor.graph.create({ name: "Live" });
      yield* Effect.yieldNow;
      assert.strictEqual((yield* executor.project).graphs[created.graph.id]?.canvas.name, "Live");
    }).pipe(Effect.provide(TestLayer)),
  );
});
