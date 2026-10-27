import { Editor } from "@macrograph/editor";
import { Engine } from "@macrograph/module";
import { DiscordEngine } from "@macrograph/module-discord/Definition";
import DiscordRestDeployment from "@macrograph/module-discord/RestDeployment";
import { ElevenLabsEngine } from "@macrograph/module-elevenlabs/Definition";
import ElevenLabsStandaloneDeployment from "@macrograph/module-elevenlabs/Deployment";
import { OpenAIEngine } from "@macrograph/module-openai/Definition";
import OpenAIStandaloneDeployment from "@macrograph/module-openai/Deployment";
import { EngineHost } from "@macrograph/project-host/EngineHost";
import { Effect, Layer } from "effect";

import {
  ids,
  JsonModule,
  ListModule,
  LogicModule,
  MathModule,
  OpenCodeModule,
  StringModule,
} from "./BuiltinModules.ts";

const OpenAIDeployment = Engine.identify(ids.openai, OpenAIStandaloneDeployment);
const ElevenLabsDeployment = Engine.identify(ids.elevenlabs, ElevenLabsStandaloneDeployment);
const DiscordDeployment = Engine.identify(ids.discord, DiscordRestDeployment);

export const statelessModules = [
  JsonModule,
  ListModule,
  LogicModule,
  MathModule,
  StringModule,
] as const;
// Discord runs only its REST and webhook actions; gateway events need a long-lived connection.
export const apiDeployments = [OpenAIDeployment, ElevenLabsDeployment, DiscordDeployment] as const;
/** Engine modules whose deployment needs a project-scoped service supplied by ProjectEditorDO. */
export const projectScopedModules = [OpenCodeModule] as const;

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
