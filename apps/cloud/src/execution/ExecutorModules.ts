import { Engine } from "@macrograph/module";
import { WebhookDeliveryEvent } from "@macrograph/module-github/Definition";
import { Payment } from "@macrograph/module-kofi/Definition";
import { RequestFailure as OpenCodeFailure } from "@macrograph/module-opencode/Definition";
import { makeLayer as makeOpenCodeLayer } from "@macrograph/module-opencode/Engine";
import { InboundMessage } from "@macrograph/module-sendblue/Definition";
import { SubscriptionEvent } from "@macrograph/module-twitch/Definition";
import { TickEvent } from "@macrograph/module-utilities/Definition";
import { ExecutorModules } from "@macrograph/project-host";
import { Effect, Schema } from "effect";

import {
  GitHubModule,
  GitHubWebhookDeployment as GitHubDeployment,
  HttpClientDeployment,
  HttpClientModule,
  ids,
  KofiModule,
  KofiWebhookDeployment as KofiDeployment,
  OpenCodeModule,
  SendblueModule,
  SendblueWebhookDeployment as SendblueDeployment,
  TwitchModule,
  TwitchWebhookDeployment as TwitchDeployment,
  UtilitiesDeployment,
  UtilitiesModule,
} from "../modules/BuiltinModules.ts";
import { apiDeployments, statelessModules } from "../modules/CloudModules.ts";

const [openai, elevenlabs, discord] = apiDeployments;
const openCode = Engine.identify(
  ids.opencode,
  Engine.deployment(
    OpenCodeModule,
    makeOpenCodeLayer({
      connectionTypes: ["managed", "remote"],
      resolve: () =>
        Effect.fail(new OpenCodeFailure({ reason: "OpenCode runtime is unavailable" })),
    }),
  ),
);

export const registry = ExecutorModules.make([
  ExecutorModules.entry(TwitchModule, SubscriptionEvent.Any, TwitchDeployment),
  ExecutorModules.entry(KofiModule, Payment, KofiDeployment),
  ExecutorModules.entry(SendblueModule, InboundMessage, SendblueDeployment),
  ExecutorModules.entry(HttpClientModule, Schema.Never, HttpClientDeployment),
  ExecutorModules.entry(GitHubModule, WebhookDeliveryEvent, GitHubDeployment),
  ExecutorModules.entry(UtilitiesModule, TickEvent, UtilitiesDeployment),
  ...statelessModules.map((module) => ExecutorModules.entry(module)),
  ExecutorModules.entry(openai.module, Schema.Never, openai),
  ExecutorModules.entry(elevenlabs.module, Schema.Never, elevenlabs),
  ExecutorModules.entry(discord.module, Schema.Never, discord),
  ExecutorModules.entry(OpenCodeModule, Schema.Never, openCode),
]);
