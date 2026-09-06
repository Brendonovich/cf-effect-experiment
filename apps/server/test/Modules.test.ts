import { NodeServices, NodeSocket } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Editor, EditorEvents, EditorRpc, EditorServer, Packages } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { Engine } from "@macrograph/module";
import Discord from "@macrograph/module-discord/Deployment";
import ElevenLabs from "@macrograph/module-elevenlabs/Deployment";
import ElgatoKeyLight from "@macrograph/module-elgato-key-light/Deployment";
import Filesystem from "@macrograph/module-fs/Deployment";
import GoXLR from "@macrograph/module-goxlr/Deployment";
import HttpClient from "@macrograph/module-http-client/Deployment/Local";
import IkeaTradfri from "@macrograph/module-ikea-tradfri/Deployment";
import Json from "@macrograph/module-json";
import LIFX from "@macrograph/module-lifx/Deployment";
import List from "@macrograph/module-list";
import Logic from "@macrograph/module-logic";
import Math from "@macrograph/module-math";
import OBS from "@macrograph/module-obs/Deployment/WebSocket";
import OpenAI from "@macrograph/module-openai/Deployment";
import Shell from "@macrograph/module-shell/Deployment";
import SpeakerBot from "@macrograph/module-speakerbot/Deployment";
import StreamDeck from "@macrograph/module-streamdeck/Deployment";
import Streamlabs from "@macrograph/module-streamlabs/Deployment";
import Strings from "@macrograph/module-string";
import TikTok from "@macrograph/module-tiktok-euler-stream/Deployment";
import Twitch from "@macrograph/module-twitch/Deployment/WebSocket";
import Utilities from "@macrograph/module-utilities/Deployment";
import Voicemod from "@macrograph/module-voicemod/Deployment";
import VTubeStudio from "@macrograph/module-vtube-studio/Deployment";
import WebSocketClient from "@macrograph/module-websocket-client/Deployment/Local";
import WebSocketServer from "@macrograph/module-websocket-server/Deployment";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcSerialization } from "effect/unstable/rpc";

import { ModuleHost } from "../src/ModuleHost.ts";
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

const statelessModules = [Json, List, Logic, Math, Strings];

const mounted = Layer.mergeAll(
  ModuleHost.deploymentLayer(Discord),
  ModuleHost.deploymentLayer(ElevenLabs),
  ModuleHost.deploymentLayer(ElgatoKeyLight),
  ModuleHost.deploymentLayer(Filesystem),
  ModuleHost.deploymentLayer(GoXLR),
  ModuleHost.deploymentLayer(HttpClient),
  ModuleHost.deploymentLayer(IkeaTradfri),
  ModuleHost.deploymentLayer(LIFX),
  ModuleHost.deploymentLayer(OBS),
  ModuleHost.deploymentLayer(OpenAI),
  ModuleHost.deploymentLayer(Shell),
  ModuleHost.deploymentLayer(SpeakerBot),
  ModuleHost.deploymentLayer(StreamDeck),
  ModuleHost.deploymentLayer(Streamlabs),
  ModuleHost.deploymentLayer(TikTok),
  ModuleHost.deploymentLayer(Twitch),
  ModuleHost.deploymentLayer(Utilities),
  ModuleHost.deploymentLayer(Voicemod),
  ModuleHost.deploymentLayer(VTubeStudio),
  ModuleHost.deploymentLayer(WebSocketClient),
  ModuleHost.deploymentLayer(WebSocketServer),
  ...statelessModules.map(ModuleHost.moduleLayer),
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

describe("Self-hosted modules", () => {
  it("have distinct module, engine, context, and client RPC identifiers", () => {
    for (const ids of [
      deployments.map((deployment) => deployment.moduleId),
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
      const registry = yield* ModuleHost.Service;
      const catalog = yield* packages.getPackages();
      assert.deepStrictEqual(
        catalog.map((module) => module.id).sort(),
        [
          "CustomTypes",
          ...deployments.map((deployment) => deployment.moduleId),
          ...statelessModules.map((module) => module.id),
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
        ["shell", 1],
        ["speakerbot", 6],
        ["streamdeck", 2],
        ["streamlabs", 5],
        ["string", 26],
        ["tiktok-euler-stream", 19],
        ["twitch", 92],
        ["util", 6],
        ["voicemod", 3],
        ["vtube-studio", 6],
      ] as const) {
        assert.lengthOf(catalog.find((module) => module.id === id)!.schemas, count, id);
      }
      for (const deployment of deployments) {
        assert.isDefined(yield* editor.engine.getRuntimeClient(deployment.moduleId));
        assert.strictEqual((yield* registry.get(deployment.moduleId))._tag, "Some");
      }
      for (const module of statelessModules) {
        assert.isUndefined(module.engine);
        assert.strictEqual((yield* registry.get(module.id))._tag, "None");
        assert.strictEqual(
          (yield* editor.engine.getRuntimeClient(module.id).pipe(Effect.flip))._tag,
          "EngineNotHosted",
        );
        assert.strictEqual(
          (yield* editor.engine.getClientState(module.id).pipe(Effect.flip))._tag,
          "EngineNotHosted",
        );
      }
    }).pipe(Effect.scoped, Effect.provide(ModuleHost.layer), Effect.provide(services)),
  );
});
