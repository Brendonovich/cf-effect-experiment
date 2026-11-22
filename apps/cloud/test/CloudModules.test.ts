import { assert, describe, it } from "@effect/vitest";
import { GraphId, PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { Engine } from "@macrograph/module";
import { DiscordEngine } from "@macrograph/module-discord/Definition";
import { ElevenLabsEngine } from "@macrograph/module-elevenlabs/Definition";
import { ModuleRegistry, StaticRegistry } from "@macrograph/module-host/core";
import { OpenAIEngine } from "@macrograph/module-openai/Definition";
import { Persistence } from "@macrograph/persistence";
import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { readFileSync } from "node:fs";

import * as CloudModules from "../src/modules/CloudModules.ts";
import { identity, moduleClient, routeClient, testEditorHost } from "./moduleRpc.ts";

const services = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
);
const http = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make(() => Effect.die("Editor startup must not call a provider")),
);
const allIds = Object.values(CloudModules.ids).sort();
const discordState = (configured: boolean) => ({
  configured,
  gatewayAvailable: false,
  gatewayEnabled: false,
  messageContent: false,
  status: "disconnected",
});

/** The project editor's registry, and module RPC clients served by the module route. */
const editorModules = Effect.gen(function* () {
  const context = yield* Layer.build(CloudModules.registryLayer(testEditorHost));
  const registry = Context.get(context, ModuleRegistry.Service);
  const client = routeClient(registry, {
    projectId: "project-1",
    headers: identity("owner"),
    scope: yield* Effect.scope,
  });
  return {
    registry,
    openai: yield* moduleClient(OpenAIEngine.ClientRpcs, CloudModules.ids.openai, client),
    elevenlabs: yield* moduleClient(
      ElevenLabsEngine.ClientRpcs,
      CloudModules.ids.elevenlabs,
      client,
    ),
    discord: yield* moduleClient(DiscordEngine.ClientRpcs, CloudModules.ids.discord, client),
  };
});

describe("Cloud modules", () => {
  it("carries every host's facets in one list that matches the packages", () => {
    assert.deepStrictEqual(CloudModules.modules.map((module) => module.id).sort(), allIds);
    assert.deepStrictEqual(CloudModules.staticModules.map(StaticRegistry.id).sort(), allIds);
    for (const module of CloudModules.modules) {
      const config = JSON.parse(
        readFileSync(
          new URL(
            `../../../packages/modules/${module.static.manifest.name}/package.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ).macrograph;
      assert.deepStrictEqual(
        [
          module.static.manifest.displayName,
          module.static.manifest.description,
          module.static.manifest.version,
        ],
        [config.displayName, config.description, config.version],
        module.id,
      );
      assert.isTrue(
        CloudModules.executorRegistry.entries.some((entry) => entry.id === module.id),
        module.id,
      );
    }
    for (const deployment of [
      ...CloudModules.httpIngressDeployments,
      ...CloudModules.pollingIngressDeployments,
    ])
      assert.isTrue(CloudModules.byId.has(deployment.moduleId), deployment.moduleId);
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
            const { registry, openai, elevenlabs, discord } = yield* editorModules;
            assert.deepStrictEqual(
              (yield* registry.catalog).filter((entry) => entry.status !== "loaded"),
              [],
            );
            const editor = yield* Editor.Service;
            const packages = yield* Packages.Service;
            assert.deepStrictEqual(
              (yield* packages.getPackages()).map((pkg) => pkg.id).sort(),
              [
                "macrograph.app/macrograph/custom-types",
                "macrograph.app/macrograph/functions",
                ...allIds,
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
            for (const id of [
              CloudModules.ids.json,
              CloudModules.ids.list,
              CloudModules.ids.logic,
              CloudModules.ids.math,
              CloudModules.ids.string,
            ])
              assert.strictEqual(
                (yield* editor.engine.getRuntimeClient(id).pipe(Effect.flip))._tag,
                "EngineNotHosted",
              );
            yield* openai.OpenAIUpdateKey({ apiKey: "openai-secret" });
            yield* elevenlabs.ElevenLabsUpdateKey({ apiKey: "elevenlabs-secret" });
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
            yield* editorModules;
            const editor = yield* Editor.Service;
            const packages = yield* Packages.Service;
            assert.deepStrictEqual(
              (yield* packages.getPackages()).map((pkg) => pkg.id).sort(),
              [
                "macrograph.app/macrograph/custom-types",
                "macrograph.app/macrograph/functions",
                ...allIds,
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
