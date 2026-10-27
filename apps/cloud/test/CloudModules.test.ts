import { assert, describe, it } from "@effect/vitest";
import { GraphId, PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, EditorEvents, EditorRpc, EditorServer, Packages } from "@macrograph/editor";
import { Engine } from "@macrograph/module";
import { DiscordEngine } from "@macrograph/module-discord/Definition";
import { ElevenLabsEngine } from "@macrograph/module-elevenlabs/Definition";
import { HttpClientEngine } from "@macrograph/module-http-client/Definition";
import { KofiEngine } from "@macrograph/module-kofi/Definition";
import { OpenAIEngine } from "@macrograph/module-openai/Definition";
import { OpenCodeEngine } from "@macrograph/module-opencode/Definition";
import { TwitchEngine } from "@macrograph/module-twitch/Definition";
import { UtilitiesEngine } from "@macrograph/module-utilities/Definition";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { RpcTest } from "effect/rpc";

import { registry } from "../src/execution/ExecutorModules.ts";
import * as CloudModules from "../src/modules/CloudModules.ts";

const services = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
);
const http = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make(() => Effect.die("Editor startup must not call a provider")),
);
const newIds = [
  "macrograph.app/macrograph/discord",
  "macrograph.app/macrograph/elevenlabs",
  "macrograph.app/macrograph/json",
  "macrograph.app/macrograph/list",
  "macrograph.app/macrograph/logic",
  "macrograph.app/macrograph/math",
  "macrograph.app/macrograph/openai",
  "macrograph.app/macrograph/opencode",
  "macrograph.app/macrograph/string",
];
const staticEditorIds = newIds.filter((id) => id !== "macrograph.app/macrograph/opencode");
const discordState = (configured: boolean) => ({
  configured,
  gatewayAvailable: false,
  gatewayEnabled: false,
  messageContent: false,
  status: "disconnected",
});

describe("Cloud modules", () => {
  it("shares supported modules with execution and keeps settings RPCs distinct and write-only", () => {
    const ids = [
      ...CloudModules.statelessModules.map((module) => module.id),
      ...CloudModules.apiDeployments.map((deployment) => deployment.moduleId),
      ...CloudModules.projectScopedModules.map((module) => module.id),
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
        OpenCodeEngine.ClientRpcs,
        ...CloudModules.apiDeployments.map((deployment) => deployment.definition.ClientRpcs),
      ),
    );
    for (const deployment of CloudModules.apiDeployments)
      for (const tag of deployment.definition.ClientRpcs.requests.keys())
        assert.isTrue(EditorRpc.requiresWriteAccess(tag), tag);
    for (const tag of OpenCodeEngine.ClientRpcs.requests.keys())
      assert.isTrue(EditorRpc.requiresWriteAccess(tag), tag);
  });

  it.effect(
    "adds modules to existing projects and rebuilds their catalog and settings after restart",
    () =>
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        const graphId = GraphId.make("existing-graph");
        const original: Project.Model = {
          ...Project.empty(),
          name: "Existing cloud project",
          engines: { "macrograph.app/macrograph/twitch": { accounts: {} } },
          graphs: {
            [graphId]: {
              canvas: { id: graphId, name: "Existing graph", nodes: {}, connections: [] },
            },
          },
        };
        yield* persistence.saveProject(original);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(CloudModules.editorLayer);
            const editor = yield* Editor.Service;
            const packages = yield* Packages.Service;
            assert.deepStrictEqual(
              (yield* packages.getPackages()).map((pkg) => pkg.id).sort(),
              [
                "macrograph.app/macrograph/custom-types",
                "macrograph.app/macrograph/functions",
                ...staticEditorIds,
              ].sort(),
            );
            assert.deepStrictEqual(yield* editor.project.get(), original);
            assert.deepStrictEqual(
              yield* editor.engine.getClientState("macrograph.app/macrograph/openai"),
              {
                configured: false,
              },
            );
            assert.deepStrictEqual(
              yield* editor.engine.getClientState("macrograph.app/macrograph/elevenlabs"),
              {
                configured: false,
              },
            );
            assert.deepStrictEqual(
              yield* editor.engine.getClientState("macrograph.app/macrograph/discord"),
              discordState(false),
            );
            const discordPackage = (yield* packages.getPackages()).find(
              (pkg) => pkg.id === "macrograph.app/macrograph/discord",
            );
            assert.deepStrictEqual(discordPackage?.schemas.map((schema) => schema.id).sort(), [
              "DiscordGetGuildMember",
              "DiscordGetRole",
              "DiscordGetUser",
              "DiscordSendMessage",
              "DiscordSendWebhook",
            ]);
            for (const module of CloudModules.statelessModules)
              assert.strictEqual(
                (yield* editor.engine.getRuntimeClient(module.id).pipe(Effect.flip))._tag,
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
            const discord = yield* RpcTest.makeClient(DiscordEngine.ClientRpcs).pipe(
              Effect.provide(context),
            );
            yield* discord.DiscordConfigure({
              token: "discord-secret",
              gatewayEnabled: true,
              messageContent: true,
            });
            assert.strictEqual(
              (yield* discord
                .DiscordSetGateway({ enabled: true, messageContent: true })
                .pipe(Effect.flip)).reason,
              "gateway-unavailable",
            );
            yield* editor.node.create({
              graphID: graphId,
              node: {
                schema: {
                  package: PackageId.make("macrograph.app/macrograph/math"),
                  schema: SchemaId.make("AddInts"),
                },
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
        assert.deepStrictEqual(
          saved.engines["macrograph.app/macrograph/twitch"],
          original.engines["macrograph.app/macrograph/twitch"],
        );
        assert.deepStrictEqual(saved.engines["macrograph.app/macrograph/openai"], {
          apiKey: "openai-secret",
        });
        assert.deepStrictEqual(saved.engines["macrograph.app/macrograph/elevenlabs"], {
          apiKey: "elevenlabs-secret",
        });
        assert.deepStrictEqual(saved.engines["macrograph.app/macrograph/discord"], {
          token: "discord-secret",
          gatewayEnabled: false,
          messageContent: true,
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Layer.build(CloudModules.editorLayer);
            const editor = yield* Editor.Service;
            const packages = yield* Packages.Service;
            assert.deepStrictEqual(
              (yield* packages.getPackages()).map((pkg) => pkg.id).sort(),
              [
                "macrograph.app/macrograph/custom-types",
                "macrograph.app/macrograph/functions",
                ...staticEditorIds,
              ].sort(),
            );
            const snapshot = yield* editor.project.snapshot();
            assert.deepStrictEqual(snapshot.project, {
              ...saved,
              graphs: Project.canvases(saved),
            });
            const node = Object.values(saved.graphs[graphId]!.canvas.nodes)[0]!;
            assert.isDefined(snapshot.nodeIO[graphId]?.[node.id]);
            assert.deepStrictEqual(
              yield* editor.engine.getClientState("macrograph.app/macrograph/openai"),
              {
                configured: true,
              },
            );
            assert.deepStrictEqual(
              yield* editor.engine.getClientState("macrograph.app/macrograph/elevenlabs"),
              {
                configured: true,
              },
            );
            assert.deepStrictEqual(
              yield* editor.engine.getClientState("macrograph.app/macrograph/discord"),
              {
                ...discordState(true),
                messageContent: true,
              },
            );
          }).pipe(
            Effect.provide(services),
            Effect.provide(Engine.emptyCredentialsLayer),
            Effect.provide(http),
          ),
        );
      }).pipe(Effect.provide(Persistence.layerMemory)),
  );
});
