import type { Project } from "@macrograph/core";

import * as Executor from "@macrograph/execution/Executor";
import ElevenLabsPlugin from "@macrograph/plugin-elevenlabs";
import { ElevenLabsEngine } from "@macrograph/plugin-elevenlabs/Definition";
import { layer as elevenLabsLayer } from "@macrograph/plugin-elevenlabs/Engine";
import HttpClientPlugin from "@macrograph/plugin-http-client";
import { makeRuntimeClient as makeHttpClientRuntime } from "@macrograph/plugin-http-client/Engine";
import { secureLayer as secureHttpUrlPolicy } from "@macrograph/plugin-http-client/UrlPolicy";
import OpenAIPlugin from "@macrograph/plugin-openai";
import { OpenAIEngine } from "@macrograph/plugin-openai/Definition";
import { layer as openAILayer } from "@macrograph/plugin-openai/Engine";
import TwitchPlugin from "@macrograph/plugin-twitch";
import { unavailableRuntimeClient as unavailableTwitchRuntime } from "@macrograph/plugin-twitch/Engine";
import { Effect, Layer, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";

export const make = Effect.fnUntraced(function* (project: Project.Model) {
  const readOnly = Effect.die("Workflow engine context is read-only");
  const context = {
    resource: { refresh: () => readOnly },
    credentials: {
      get: Effect.succeed([]),
      refresh: () => Effect.die("Workflow session credentials are unavailable"),
      subscribe: () => readOnly,
    },
    client: { refresh: readOnly },
    emit: () => readOnly,
  };
  const httpClient = yield* makeHttpClientRuntime().pipe(Effect.provide(secureHttpUrlPolicy));

  // Registration requests every engine client. Decode only when a runtime RPC reads storage.
  const openAI = yield* OpenAIEngine.pipe(
    Effect.provide(openAILayer),
    Effect.provide(
      Layer.succeed(OpenAIEngine.EngineContext)(
        OpenAIEngine.EngineContext.of({
          ...context,
          storage: {
            get: Schema.decodeUnknownEffect(OpenAIEngine.Storage)(
              project.engines[OpenAIPlugin.id] ?? OpenAIEngine.InitialStorage,
            ).pipe(
              Effect.mapError(() => "Invalid OpenAI deployment storage"),
              Effect.orDie,
            ),
            set: () => readOnly,
            update: () => readOnly,
          },
        }),
      ),
    ),
  );
  const openAIClient = yield* RpcTest.makeClient(OpenAIEngine.Rpcs).pipe(
    Effect.provide(openAI.rpcs),
  );
  const elevenLabs = yield* ElevenLabsEngine.pipe(
    Effect.provide(elevenLabsLayer),
    Effect.provide(
      Layer.succeed(ElevenLabsEngine.EngineContext)(
        ElevenLabsEngine.EngineContext.of({
          ...context,
          storage: {
            get: Schema.decodeUnknownEffect(ElevenLabsEngine.Storage)(
              project.engines[ElevenLabsPlugin.id] ?? ElevenLabsEngine.InitialStorage,
            ).pipe(
              Effect.mapError(() => "Invalid ElevenLabs deployment storage"),
              Effect.orDie,
            ),
            set: () => readOnly,
            update: () => readOnly,
          },
        }),
      ),
    ),
  );
  const elevenLabsClient = yield* RpcTest.makeClient(ElevenLabsEngine.Rpcs).pipe(
    Effect.provide(elevenLabs.rpcs),
  );

  const engineClient: NonNullable<Executor.MakeOptions["engineClient"]> = (pluginId) =>
    Effect.succeed(
      pluginId === HttpClientPlugin.id
        ? httpClient
        : pluginId === OpenAIPlugin.id
          ? openAIClient
          : pluginId === ElevenLabsPlugin.id
            ? elevenLabsClient
            : pluginId === TwitchPlugin.id
              ? unavailableTwitchRuntime
              : new Proxy(
                  {},
                  {
                    get: () => () =>
                      Effect.fail(new Executor.EngineClientUnavailable({ pluginId })),
                  },
                ),
    );
  return engineClient;
});
