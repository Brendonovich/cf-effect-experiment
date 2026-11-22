import { NodeServices, NodeSocket } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { PackageId, Project } from "@macrograph/core";
import { Editor, EditorEvents, type EditorEvent, Packages } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { LiveRuntime } from "@macrograph/live-runtime";
import { Engine, Manifest, Module, ModuleId } from "@macrograph/module";
import { ModuleEvaluator } from "@macrograph/module-host/ModuleEvaluator";
import { ModuleRegistry } from "@macrograph/module-host/ModuleRegistry";
import { Installer } from "@macrograph/module-installer/Installer";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, Option, PubSub } from "effect";
import { FetchHttpClient } from "effect/http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ModuleAdmin } from "../src/ModuleAdmin.ts";
import { ModuleHost } from "../src/ModuleHost.ts";

const manifest = Manifest.Model.make({
  manifest: Manifest.FormatVersion,
  publisher: "fixtures",
  name: "hello",
  version: "1.0.0",
  api: Manifest.ApiVersion,
  displayName: "Hello",
  server: "server.cjs",
});
const id = ModuleId.make({
  namespace: ModuleId.OfficialNamespace,
  publisher: "fixtures",
  name: "hello",
});
const packageId = PackageId.make(id);

const services = LiveRuntime.layer({ initialProject: Project.empty() }).pipe(
  Layer.provideMerge(
    Editor.layer.pipe(
      Layer.provideMerge(EditorEvents.layer),
      Layer.provideMerge(Packages.defaultLayer),
    ),
  ),
  Layer.provideMerge(RuntimeActivity.layer),
  Layer.provideMerge(Persistence.layerMemory),
  Layer.provideMerge(
    Layer.mergeAll(
      NodeServices.layer,
      NodeSocket.layerWebSocketConstructor,
      FetchHttpClient.layer,
      Engine.emptyCredentialsLayer,
    ),
  ),
);

const modules = ModuleAdmin.backgroundLayer.pipe(
  Layer.provideMerge(
    ModuleRegistry.layer({
      hostServices: ModuleHost.hostServices,
      watch: false,
      staticModules: [
        { manifest, deployment: Module.make({ name: "Hello", effect: () => Effect.void }) },
      ],
    }).pipe(Layer.provide([ModuleHost.mounterLayer, ModuleEvaluator.vm, ModuleAdmin.trustLayer])),
  ),
  Layer.provideMerge(
    Installer.layer({
      dataDir: mkdtempSync(join(tmpdir(), "macrograph-module-admin-")),
      official: { url: "http://127.0.0.1:1", keys: [] },
    }).pipe(Layer.orDie),
  ),
);

it.live("broadcasts ModulesChanged and PackagesChanged when a module unloads and loads", () =>
  Effect.gen(function* () {
    const registry = yield* ModuleRegistry.Service;
    const events = yield* EditorEvents.Service;
    const packages = yield* Packages.Service;
    const subscription = yield* events.subscribe;
    const next = (tag: EditorEvent.EditorEvent["_tag"]) =>
      Effect.gen(function* () {
        for (;;) {
          const event = yield* PubSub.take(subscription);
          if (event._tag === tag) return event;
        }
      });

    assert.isTrue((yield* packages.getPackages()).some((pkg) => pkg.id === packageId));
    yield* registry.setEnabled(id, false);
    yield* next("PackagesChanged");
    yield* next("ModulesChanged");
    assert.isFalse((yield* packages.getPackages()).some((pkg) => pkg.id === packageId));
    assert.strictEqual(
      Option.map(yield* registry.get(id), (entry) => entry.status).pipe(Option.getOrUndefined),
      "disabled",
    );

    yield* registry.setEnabled(id, true);
    yield* next("PackagesChanged");
    yield* next("ModulesChanged");
    assert.isTrue((yield* packages.getPackages()).some((pkg) => pkg.id === packageId));
  }).pipe(Effect.scoped, Effect.provide(modules), Effect.provide(services)),
);
