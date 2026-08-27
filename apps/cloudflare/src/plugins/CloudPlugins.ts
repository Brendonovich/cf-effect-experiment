import { Editor } from "@macrograph/editor";
import { ElevenLabsEngine } from "@macrograph/plugin-elevenlabs/Definition";
import ElevenLabsDeployment from "@macrograph/plugin-elevenlabs/Deployment";
import JsonPlugin from "@macrograph/plugin-json";
import ListPlugin from "@macrograph/plugin-list";
import LogicPlugin from "@macrograph/plugin-logic";
import MathPlugin from "@macrograph/plugin-math";
import { OpenAIEngine } from "@macrograph/plugin-openai/Definition";
import OpenAIDeployment from "@macrograph/plugin-openai/Deployment";
import StringPlugin from "@macrograph/plugin-string";
import { EngineHost } from "@macrograph/project-host/EngineHost";
import { Effect, Layer } from "effect";

export const statelessPlugins = [
  JsonPlugin,
  ListPlugin,
  LogicPlugin,
  MathPlugin,
  StringPlugin,
] as const;
export const apiDeployments = [OpenAIDeployment, ElevenLabsDeployment] as const;

export const editorLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    for (const plugin of statelessPlugins) yield* editor.plugin(plugin);
    const openai = yield* OpenAIEngine;
    const elevenlabs = yield* ElevenLabsEngine;
    yield* EngineHost.mount(OpenAIDeployment.plugin, OpenAIDeployment, openai.client.state);
    yield* EngineHost.mount(
      ElevenLabsDeployment.plugin,
      ElevenLabsDeployment,
      elevenlabs.client.state,
    );
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
    ),
  ),
);
