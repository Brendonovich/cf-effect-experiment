import { assert, describe, it } from "@effect/vitest";
import { GraphId, PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, EditorEvents, EditorRpc, EditorServer, Packages } from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { Engine } from "@macrograph/plugin";
import { ElevenLabsEngine } from "@macrograph/plugin-elevenlabs/Definition";
import { HttpClientEngine } from "@macrograph/plugin-http-client/Definition";
import { KofiEngine } from "@macrograph/plugin-kofi/Definition";
import { OpenAIEngine } from "@macrograph/plugin-openai/Definition";
import { TwitchEngine } from "@macrograph/plugin-twitch/Definition";
import { UtilitiesEngine } from "@macrograph/plugin-utilities/Definition";
import { Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import { RpcTest } from "effect/unstable/rpc";

import { registry } from "../src/execution/ExecutorPlugins.ts";
import * as CloudPlugins from "../src/plugins/CloudPlugins.ts";

const services = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
);
const http = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make(() => Effect.die("Editor startup must not call a provider")),
);
const newIds = ["elevenlabs", "json", "list", "logic", "math", "openai", "string"];

describe("Cloud plugins", () => {
  it("shares supported plugins with execution and keeps settings RPCs distinct and write-only", () => {
    const ids = [
      ...CloudPlugins.statelessPlugins.map((plugin) => plugin.id),
      ...CloudPlugins.apiDeployments.map((deployment) => deployment.pluginId),
    ];
    assert.deepStrictEqual(ids.sort(), newIds);
    for (const id of ids)
      assert.isTrue(
        registry.entries.some((entry) => entry.id === id),
        id,
      );
    assert.doesNotThrow(() =>
      EditorServer.mergeRpcGroups(
        EditorRpc.EditorRpcs,
        KofiEngine.ClientRpcs,
        TwitchEngine.ClientRpcs,
        UtilitiesEngine.ClientRpcs,
        HttpClientEngine.ClientRpcs,
        ...CloudPlugins.apiDeployments.map((deployment) => deployment.definition.ClientRpcs),
      ),
    );
    for (const deployment of CloudPlugins.apiDeployments)
      for (const tag of deployment.definition.ClientRpcs.requests.keys())
        assert.isTrue(EditorRpc.requiresWriteAccess(tag), tag);
  });

  it.effect(
    "adds plugins to existing projects and rebuilds their catalog and settings after restart",
    () =>
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        const graphId = GraphId.make("existing-graph");
        const original: Project.Model = {
          ...Project.empty(),
          name: "Existing cloud project",
          engines: { twitch: { accounts: {} } },
          graphs: {
            [graphId]: { id: graphId, name: "Existing graph", nodes: {}, connections: [] },
          },
        };
        yield* persistence.saveProject(original);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(CloudPlugins.editorLayer);
            const editor = yield* Editor.Service;
            const packages = yield* Packages.Service;
            assert.deepStrictEqual(
              (yield* packages.getPackages()).map((pkg) => pkg.id).sort(),
              [...newIds, "macrograph-functions", "macrograph-queues"].sort(),
            );
            assert.deepStrictEqual(yield* editor.project.get(), original);
            assert.deepStrictEqual(yield* editor.engine.getClientState("openai"), {
              configured: false,
            });
            assert.deepStrictEqual(yield* editor.engine.getClientState("elevenlabs"), {
              configured: false,
            });
            for (const plugin of CloudPlugins.statelessPlugins)
              assert.strictEqual(
                (yield* editor.engine.getRuntimeClient(plugin.id).pipe(Effect.flip))._tag,
                "EngineNotHosted",
              );
            const openai = yield* RpcTest.makeClient(OpenAIEngine.ClientRpcs).pipe(
              Effect.provide(context),
            );
            const elevenlabs = yield* RpcTest.makeClient(ElevenLabsEngine.ClientRpcs).pipe(
              Effect.provide(context),
            );
            yield* openai.OpenAIUpdateKey({ apiKey: "openai-secret" });
            yield* elevenlabs.ElevenLabsUpdateKey({ apiKey: "elevenlabs-secret" });
            yield* editor.node.create({
              graphID: graphId,
              node: {
                schema: { package: PackageId.make("math"), schema: SchemaId.make("AddInts") },
                position: { x: 0, y: 0 },
              },
            });
          }).pipe(
            Effect.provide(services),
            Effect.provide(Engine.emptyCredentialsLayer),
            Effect.provide(http),
          ),
        );

        const saved = yield* persistence.loadProject();
        assert.deepStrictEqual(saved.engines.twitch, original.engines.twitch);
        assert.deepStrictEqual(saved.engines.openai, { apiKey: "openai-secret" });
        assert.deepStrictEqual(saved.engines.elevenlabs, { apiKey: "elevenlabs-secret" });
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Layer.build(CloudPlugins.editorLayer);
            const editor = yield* Editor.Service;
            const packages = yield* Packages.Service;
            assert.deepStrictEqual(
              (yield* packages.getPackages()).map((pkg) => pkg.id).sort(),
              [...newIds, "macrograph-functions", "macrograph-queues"].sort(),
            );
            const snapshot = yield* editor.project.snapshot();
            assert.deepStrictEqual(snapshot.project, saved);
            const node = Object.values(saved.graphs[graphId]!.nodes)[0]!;
            assert.isDefined(snapshot.nodeIO[graphId]?.[node.id]);
            assert.deepStrictEqual(yield* editor.engine.getClientState("openai"), {
              configured: true,
            });
            assert.deepStrictEqual(yield* editor.engine.getClientState("elevenlabs"), {
              configured: true,
            });
          }).pipe(
            Effect.provide(services),
            Effect.provide(Engine.emptyCredentialsLayer),
            Effect.provide(http),
          ),
        );
      }).pipe(Effect.provide(Persistence.layerMemory)),
  );
});
