import type { Project } from "@macrograph/core";
import type { Instances as OpenCodeInstances } from "@macrograph/module-opencode/Instance";

import * as Executor from "@macrograph/execution/Executor";
import { DiscordEngine } from "@macrograph/module-discord/Definition";
import { restLayer as discordLayer } from "@macrograph/module-discord/Engine";
import { ElevenLabsEngine } from "@macrograph/module-elevenlabs/Definition";
import { layer as elevenLabsLayer } from "@macrograph/module-elevenlabs/Engine";
import { unavailableRuntimeClient as unavailableGitHubRuntime } from "@macrograph/module-github/Engine";
import { makeRuntimeClient as makeHttpClientRuntime } from "@macrograph/module-http-client/Engine";
import { secureLayer as secureHttpUrlPolicy } from "@macrograph/module-http-client/UrlPolicy";
import { OpenAIEngine } from "@macrograph/module-openai/Definition";
import { layer as openAILayer } from "@macrograph/module-openai/Engine";
import {
  OpenCodeEngine,
  RequestFailure as OpenCodeFailure,
} from "@macrograph/module-opencode/Definition";
import { makeLayer as makeOpenCodeLayer } from "@macrograph/module-opencode/Engine";
import { SendblueEngine } from "@macrograph/module-sendblue/Definition";
import { layer as sendblueLayer } from "@macrograph/module-sendblue/Engine";
import { unavailableRuntimeClient as unavailableTwitchRuntime } from "@macrograph/module-twitch/Engine";
import { Effect, Layer, Schema } from "effect";
import { RpcTest } from "effect/rpc";

import {
  DiscordModule,
  ElevenLabsModule,
  GitHubModule,
  HttpClientModule,
  OpenAIModule,
  OpenCodeModule,
  SendblueModule,
  TwitchModule,
} from "../modules/BuiltinModules.ts";

const unavailableOpenCode: OpenCodeInstances = {
  connectionTypes: ["managed", "remote"],
  resolve: () => Effect.fail(new OpenCodeFailure({ reason: "OpenCode runtime is unavailable" })),
};

export const make = Effect.fnUntraced(function* (
  project: Project.Model,
  openCodeInstances: OpenCodeInstances = unavailableOpenCode,
) {
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
              project.engines[OpenAIModule.id] ?? OpenAIEngine.InitialStorage,
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
              project.engines[ElevenLabsModule.id] ?? ElevenLabsEngine.InitialStorage,
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
  const discord = yield* DiscordEngine.pipe(
    Effect.provide(discordLayer),
    Effect.provide(
      Layer.succeed(DiscordEngine.EngineContext)(
        DiscordEngine.EngineContext.of({
          ...context,
          storage: {
            // The Discord engine reads storage while constructing, so invalid settings must not
            // fail every workflow; its actions then report that Discord is not configured.
            get: Schema.decodeUnknownEffect(DiscordEngine.Storage)(
              project.engines[DiscordModule.id] ?? DiscordEngine.InitialStorage,
            ).pipe(
              Effect.orElseSucceed(() => ({
                token: "",
                gatewayEnabled: false,
                messageContent: false,
              })),
            ),
            set: () => readOnly,
            update: () => readOnly,
          },
        }),
      ),
    ),
  );
  const discordClient = yield* RpcTest.makeClient(DiscordEngine.Rpcs).pipe(
    Effect.provide(discord.rpcs),
  );
  const opencode = yield* OpenCodeEngine.pipe(
    Effect.provide(makeOpenCodeLayer(openCodeInstances)),
    Effect.provide(
      Layer.succeed(OpenCodeEngine.EngineContext)(
        OpenCodeEngine.EngineContext.of({
          ...context,
          storage: {
            get: Schema.decodeUnknownEffect(OpenCodeEngine.Storage)(
              project.engines[OpenCodeModule.id] ?? OpenCodeEngine.InitialStorage,
            ).pipe(
              Effect.mapError(() => "Invalid OpenCode deployment storage"),
              Effect.orDie,
            ),
            set: () => readOnly,
            update: () => readOnly,
          },
        }),
      ),
    ),
  );
  const openCodeClient = yield* RpcTest.makeClient(OpenCodeEngine.Rpcs).pipe(
    Effect.provide(opencode.rpcs),
  );
  const sendblue = yield* SendblueEngine.pipe(
    Effect.provide(sendblueLayer),
    Effect.provide(
      Layer.succeed(SendblueEngine.EngineContext)(
        SendblueEngine.EngineContext.of({
          ...context,
          storage: {
            get: Schema.decodeUnknownEffect(SendblueEngine.Storage)(
              project.engines[SendblueModule.id] ?? SendblueEngine.InitialStorage,
            ).pipe(
              Effect.mapError(() => "Invalid Sendblue deployment storage"),
              Effect.orDie,
            ),
            set: () => readOnly,
            update: () => readOnly,
          },
        }),
      ),
    ),
  );
  const sendblueClient = yield* RpcTest.makeClient(SendblueEngine.Rpcs).pipe(
    Effect.provide(sendblue.rpcs),
  );

  const engineClient: NonNullable<Executor.MakeOptions["engineClient"]> = (moduleId) =>
    Effect.succeed(
      moduleId === HttpClientModule.id
        ? httpClient
        : moduleId === OpenAIModule.id
          ? openAIClient
          : moduleId === OpenCodeModule.id
            ? openCodeClient
            : moduleId === ElevenLabsModule.id
              ? elevenLabsClient
              : moduleId === DiscordModule.id
                ? discordClient
                : moduleId === SendblueModule.id
                  ? sendblueClient
                  : moduleId === TwitchModule.id
                    ? unavailableTwitchRuntime
                    : moduleId === GitHubModule.id
                      ? unavailableGitHubRuntime
                      : new Proxy(
                          {},
                          {
                            get: () => () =>
                              Effect.fail(new Executor.EngineClientUnavailable({ moduleId })),
                          },
                        ),
    );
  return engineClient;
});
