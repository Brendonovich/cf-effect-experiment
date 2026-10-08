import { Editor } from "@macrograph/editor";
import { DiscordEngine } from "@macrograph/module-discord/Definition";
import DiscordDeployment from "@macrograph/module-discord/RestDeployment";
import { ElevenLabsEngine } from "@macrograph/module-elevenlabs/Definition";
import ElevenLabsDeployment from "@macrograph/module-elevenlabs/Deployment";
import JsonModule from "@macrograph/module-json";
import ListModule from "@macrograph/module-list";
import LogicModule from "@macrograph/module-logic";
import MathModule from "@macrograph/module-math";
import { OpenAIEngine } from "@macrograph/module-openai/Definition";
import OpenAIDeployment from "@macrograph/module-openai/Deployment";
import StringModule from "@macrograph/module-string";
import { EngineHost } from "@macrograph/project-host/EngineHost";
import { Effect, Layer } from "effect";

export const statelessModules = [
  JsonModule,
  ListModule,
  LogicModule,
  MathModule,
  StringModule,
] as const;
// Discord runs only its REST and webhook actions; gateway events need a long-lived connection.
export const apiDeployments = [OpenAIDeployment, ElevenLabsDeployment, DiscordDeployment] as const;

export const editorLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    for (const module of statelessModules) yield* editor.module(module);
    const openai = yield* OpenAIEngine;
    const elevenlabs = yield* ElevenLabsEngine;
    const discord = yield* DiscordEngine;
    yield* EngineHost.mount(OpenAIDeployment.module, OpenAIDeployment, openai.client.state);
    yield* EngineHost.mount(
      ElevenLabsDeployment.module,
      ElevenLabsDeployment,
      elevenlabs.client.state,
    );
    yield* EngineHost.mount(DiscordDeployment.module, DiscordDeployment, discord.client.state);
  }),
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      EngineHost.layer(
        OpenAIDeployment,
        EngineHost.editorContextLayer(OpenAIDeployment, { emit: () => Effect.void }),
      ),
      EngineHost.layer(
        ElevenLabsDeployment,
        EngineHost.editorContextLayer(ElevenLabsDeployment, { emit: () => Effect.void }),
      ),
      EngineHost.layer(
        DiscordDeployment,
        EngineHost.editorContextLayer(DiscordDeployment, { emit: () => Effect.void }),
      ),
    ),
  ),
);
