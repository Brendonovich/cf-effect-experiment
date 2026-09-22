import { Editor } from "@macrograph/editor";
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
export const apiDeployments = [OpenAIDeployment, ElevenLabsDeployment] as const;

export const editorLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    for (const module of statelessModules) yield* editor.module(module);
    const openai = yield* OpenAIEngine;
    const elevenlabs = yield* ElevenLabsEngine;
    yield* EngineHost.mount(OpenAIDeployment.module, OpenAIDeployment, openai.client.state);
    yield* EngineHost.mount(
      ElevenLabsDeployment.module,
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
