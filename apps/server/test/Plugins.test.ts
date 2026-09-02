import { NodeServices, NodeSocket } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Editor, EditorEvents, EditorRpc, EditorServer, Packages } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { Engine } from "@macrograph/plugin";
import Discord from "@macrograph/plugin-discord/Deployment";
import ElevenLabs from "@macrograph/plugin-elevenlabs/Deployment";
import ElgatoKeyLight from "@macrograph/plugin-elgato-key-light/Deployment";
import Filesystem from "@macrograph/plugin-fs/Deployment";
import GoXLR from "@macrograph/plugin-goxlr/Deployment";
import HttpClient from "@macrograph/plugin-http-client/Deployment/Local";
import IkeaTradfri from "@macrograph/plugin-ikea-tradfri/Deployment";
import Json from "@macrograph/plugin-json";
import LIFX from "@macrograph/plugin-lifx/Deployment";
import List from "@macrograph/plugin-list";
import Logic from "@macrograph/plugin-logic";
import Math from "@macrograph/plugin-math";
import OBS from "@macrograph/plugin-obs/Deployment/WebSocket";
import OpenAI from "@macrograph/plugin-openai/Deployment";
import OpenCode from "@macrograph/plugin-opencode/Deployment";
import Shell from "@macrograph/plugin-shell/Deployment";
import SpeakerBot from "@macrograph/plugin-speakerbot/Deployment";
import StreamDeck from "@macrograph/plugin-streamdeck/Deployment";
import Streamlabs from "@macrograph/plugin-streamlabs/Deployment";
import Strings from "@macrograph/plugin-string";
import TikTok from "@macrograph/plugin-tiktok-euler-stream/Deployment";
import Twitch from "@macrograph/plugin-twitch/Deployment/WebSocket";
import Utilities from "@macrograph/plugin-utilities/Deployment";
import Voicemod from "@macrograph/plugin-voicemod/Deployment";
import VTubeStudio from "@macrograph/plugin-vtube-studio/Deployment";
import WebSocketClient from "@macrograph/plugin-websocket-client/Deployment/Local";
import WebSocketServer from "@macrograph/plugin-websocket-server/Deployment";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcSerialization } from "effect/unstable/rpc";

import { PluginHost } from "../src/PluginHost.ts";
import { ProjectExecution } from "../src/ProjectExecution.ts";

const deployments = [
  Discord,
  ElevenLabs,
  ElgatoKeyLight,
  Filesystem,
  GoXLR,
  HttpClient,
  IkeaTradfri,
  LIFX,
  OBS,
  OpenAI,
  OpenCode,
  Shell,
  SpeakerBot,
  StreamDeck,
  Streamlabs,
  TikTok,
  Twitch,
  Utilities,
  Voicemod,
  VTubeStudio,
  WebSocketClient,
  WebSocketServer,
] as const;

const statelessPlugins = [Json, List, Logic, Math, Strings];

const mounted = Layer.mergeAll(
  PluginHost.deploymentLayer(Discord),
  PluginHost.deploymentLayer(ElevenLabs),
  PluginHost.deploymentLayer(ElgatoKeyLight),
  PluginHost.deploymentLayer(Filesystem),
  PluginHost.deploymentLayer(GoXLR),
  PluginHost.deploymentLayer(HttpClient),
  PluginHost.deploymentLayer(IkeaTradfri),
  PluginHost.deploymentLayer(LIFX),
  PluginHost.deploymentLayer(OBS),
  PluginHost.deploymentLayer(OpenAI),
  PluginHost.deploymentLayer(OpenCode),
  PluginHost.deploymentLayer(Shell),
  PluginHost.deploymentLayer(SpeakerBot),
  PluginHost.deploymentLayer(StreamDeck),
  PluginHost.deploymentLayer(Streamlabs),
  PluginHost.deploymentLayer(TikTok),
  PluginHost.deploymentLayer(Twitch),
  PluginHost.deploymentLayer(Utilities),
  PluginHost.deploymentLayer(Voicemod),
  PluginHost.deploymentLayer(VTubeStudio),
  PluginHost.deploymentLayer(WebSocketClient),
  PluginHost.deploymentLayer(WebSocketServer),
  ...statelessPlugins.map(PluginHost.pluginLayer),
);

const services = ProjectExecution.layer.pipe(
  Layer.provideMerge(
    Editor.layer.pipe(
      Layer.provideMerge(EditorEvents.layer),
      Layer.provideMerge(Packages.defaultLayer),
    ),
  ),
  Layer.provideMerge(RuntimeActivity.layer),
  Layer.provideMerge(Persistence.layerMemory),
);

describe("Self-hosted plugins", () => {
  it("have distinct plugin, engine, context, and client RPC identifiers", () => {
    for (const ids of [
      deployments.map((deployment) => deployment.pluginId),
      deployments.map((deployment) => deployment.definition.key),
      deployments.map((deployment) => deployment.definition.EngineContext.key),
    ])
      assert.strictEqual(new Set(ids).size, deployments.length);
    assert.doesNotThrow(() =>
      EditorServer.mergeRpcGroups(
        EditorRpc.EditorRpcs,
        RuntimeActivity.Rpcs,
        ...deployments.map((deployment) => deployment.definition.ClientRpcs),
      ),
    );
  });

  it.effect("mount every catalog and runtime together without configuration", () =>
    Effect.gen(function* () {
      yield* Layer.build(
        mounted.pipe(
          Layer.provide([
            NodeServices.layer,
            NodeSocket.layerWebSocketConstructor,
            FetchHttpClient.layer,
            Engine.emptyCredentialsLayer,
            RpcSerialization.layerJsonRpc(),
          ]),
        ),
      );
      const packages = yield* Packages.Service;
      const editor = yield* Editor.Service;
      const registry = yield* PluginHost.Service;
      const catalog = yield* packages.getPackages();
      assert.deepStrictEqual(
        catalog.map((plugin) => plugin.id).sort(),
        [
          ...deployments.map((deployment) => deployment.pluginId),
          ...statelessPlugins.map((plugin) => plugin.id),
        ].sort(),
      );
      for (const [id, count] of [
        ["discord", 6],
        ["elevenlabs", 1],
        ["elgato-key-light", 10],
        ["fs", 4],
        ["goxlr", 13],
        ["http-client", 7],
        ["ikea-tradfri", 6],
        ["json", 19],
        ["lifx", 6],
        ["list", 11],
        ["logic", 18],
        ["math", 33],
        ["obs", 209],
        ["openai", 2],
        ["opencode", 3],
        ["shell", 1],
        ["speakerbot", 6],
        ["streamdeck", 2],
        ["streamlabs", 5],
        ["string", 26],
        ["tiktok-euler-stream", 19],
        ["twitch", 92],
        ["util", 7],
        ["voicemod", 3],
        ["vtube-studio", 6],
      ] as const) {
        assert.lengthOf(catalog.find((plugin) => plugin.id === id)!.schemas, count, id);
      }
      for (const deployment of deployments) {
        assert.isDefined(yield* editor.engine.getRuntimeClient(deployment.pluginId));
        assert.strictEqual((yield* registry.get(deployment.pluginId))._tag, "Some");
      }
      for (const plugin of statelessPlugins) {
        assert.isUndefined(plugin.engine);
        assert.strictEqual((yield* registry.get(plugin.id))._tag, "None");
        assert.strictEqual(
          (yield* editor.engine.getRuntimeClient(plugin.id).pipe(Effect.flip))._tag,
          "EngineNotHosted",
        );
        assert.strictEqual(
          (yield* editor.engine.getClientState(plugin.id).pipe(Effect.flip))._tag,
          "EngineNotHosted",
        );
      }
    }).pipe(Effect.scoped, Effect.provide(PluginHost.layer), Effect.provide(services)),
  );
});
