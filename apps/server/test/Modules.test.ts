import { NodeServices, NodeSocket } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  CustomTypes,
  Function as GraphFunction,
  PackageId,
  Project,
  Queue,
} from "@macrograph/core";
import { Editor, EditorEvents, EditorRpc, EditorServer, Packages } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { LiveRuntime } from "@macrograph/live-runtime";
import { Engine, Module } from "@macrograph/module";
import DiscordDefinition from "@macrograph/module-discord/Deployment";
import ElevenLabsDefinition from "@macrograph/module-elevenlabs/Deployment";
import ElgatoKeyLightDefinition from "@macrograph/module-elgato-key-light/Deployment";
import FilesystemDefinition from "@macrograph/module-fs/Deployment";
import GoXLRDefinition from "@macrograph/module-goxlr/Deployment";
import HttpClientDefinition from "@macrograph/module-http-client/Deployment/Local";
import IkeaTradfriDefinition from "@macrograph/module-ikea-tradfri/Deployment";
import JsonDefinition from "@macrograph/module-json";
import LIFXDefinition from "@macrograph/module-lifx/Deployment";
import ListDefinition from "@macrograph/module-list";
import LogicDefinition from "@macrograph/module-logic";
import MathDefinition from "@macrograph/module-math";
import MidiDefinition from "@macrograph/module-midi/Deployment";
import OBSDefinition from "@macrograph/module-obs/Deployment/WebSocket";
import OpenAIDefinition from "@macrograph/module-openai/Deployment";
import OpenCodeDefinition from "@macrograph/module-opencode/Deployment/Server";
import SendblueDefinition from "@macrograph/module-sendblue/Deployment";
import ShellDefinition from "@macrograph/module-shell/Deployment";
import SpeakerBotDefinition from "@macrograph/module-speakerbot/Deployment";
import StreamDeckDefinition from "@macrograph/module-streamdeck/Deployment";
import StreamlabsDefinition from "@macrograph/module-streamlabs/Deployment";
import StringsDefinition from "@macrograph/module-string";
import TikTokDefinition from "@macrograph/module-tiktok-euler-stream/Deployment";
import TwitchDefinition from "@macrograph/module-twitch/Deployment/WebSocket";
import UtilitiesDefinition from "@macrograph/module-utilities/Deployment";
import VoicemodDefinition from "@macrograph/module-voicemod/Deployment";
import VTubeStudioDefinition from "@macrograph/module-vtube-studio/Deployment";
import WebSocketClientDefinition from "@macrograph/module-websocket-client/Deployment/Local";
import WebSocketServerDefinition from "@macrograph/module-websocket-server/Deployment";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcSerialization } from "effect/rpc";

import { ModuleHost } from "../src/ModuleHost.ts";

const Discord = Engine.identify(Module.builtinId("discord"), DiscordDefinition);
const ElevenLabs = Engine.identify(Module.builtinId("elevenlabs"), ElevenLabsDefinition);
const ElgatoKeyLight = Engine.identify(
  Module.builtinId("elgato-key-light"),
  ElgatoKeyLightDefinition,
);
const Filesystem = Engine.identify(Module.builtinId("fs"), FilesystemDefinition);
const GoXLR = Engine.identify(Module.builtinId("goxlr"), GoXLRDefinition);
const HttpClient = Engine.identify(Module.builtinId("http-client"), HttpClientDefinition);
const IkeaTradfri = Engine.identify(Module.builtinId("ikea-tradfri"), IkeaTradfriDefinition);
const Json = Module.identify(Module.builtinId("json"), JsonDefinition);
const LIFX = Engine.identify(Module.builtinId("lifx"), LIFXDefinition);
const List = Module.identify(Module.builtinId("list"), ListDefinition);
const Logic = Module.identify(Module.builtinId("logic"), LogicDefinition);
const Math = Module.identify(Module.builtinId("math"), MathDefinition);
const Midi = Engine.identify(Module.builtinId("midi"), MidiDefinition);
const OBS = Engine.identify(Module.builtinId("obs"), OBSDefinition);
const OpenAI = Engine.identify(Module.builtinId("openai"), OpenAIDefinition);
const OpenCode = Engine.identify(Module.builtinId("opencode"), OpenCodeDefinition);
const Sendblue = Engine.identify(Module.builtinId("sendblue"), SendblueDefinition);
const Shell = Engine.identify(Module.builtinId("shell"), ShellDefinition);
const SpeakerBot = Engine.identify(Module.builtinId("speakerbot"), SpeakerBotDefinition);
const StreamDeck = Engine.identify(Module.builtinId("streamdeck"), StreamDeckDefinition);
const Streamlabs = Engine.identify(Module.builtinId("streamlabs"), StreamlabsDefinition);
const Strings = Module.identify(Module.builtinId("string"), StringsDefinition);
const TikTok = Engine.identify(Module.builtinId("tiktok-euler-stream"), TikTokDefinition);
const Twitch = Engine.identify(Module.builtinId("twitch"), TwitchDefinition);
const Utilities = Engine.identify(Module.builtinId("utilities"), UtilitiesDefinition);
const Voicemod = Engine.identify(Module.builtinId("voicemod"), VoicemodDefinition);
const VTubeStudio = Engine.identify(Module.builtinId("vtube-studio"), VTubeStudioDefinition);
const WebSocketClient = Engine.identify(
  Module.builtinId("websocket-client"),
  WebSocketClientDefinition,
);
const WebSocketServer = Engine.identify(
  Module.builtinId("websocket-server"),
  WebSocketServerDefinition,
);

const deployments = [
  Discord,
  ElevenLabs,
  ElgatoKeyLight,
  Filesystem,
  GoXLR,
  HttpClient,
  IkeaTradfri,
  LIFX,
  Midi,
  OBS,
  OpenAI,
  OpenCode,
  Sendblue,
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
  ModuleHost.deploymentLayer(Midi),
  ModuleHost.deploymentLayer(OBS),
  ModuleHost.deploymentLayer(OpenAI),
  ModuleHost.deploymentLayer(OpenCode),
  ModuleHost.deploymentLayer(Sendblue),
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

const services = LiveRuntime.layer({ initialProject: Project.empty() }).pipe(
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
          CustomTypes.packageId,
          GraphFunction.packageId,
          Queue.packageId,
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
        ["midi", 18],
        ["obs", 209],
        ["openai", 2],
        ["opencode", 1],
        ["shell", 1],
        ["speakerbot", 6],
        ["streamdeck", 2],
        ["streamlabs", 5],
        ["string", 26],
        ["tiktok-euler-stream", 19],
        ["twitch", 92],
        ["utilities", 6],
        ["voicemod", 3],
        ["vtube-studio", 6],
      ] as const) {
        assert.lengthOf(
          catalog.find((module) => module.id === PackageId.make(Module.builtinId(id)))!.schemas,
          count,
          id,
        );
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
