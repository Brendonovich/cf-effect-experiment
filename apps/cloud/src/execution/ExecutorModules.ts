import { Engine } from "@macrograph/module";
import GitHubModule from "@macrograph/module-github";
import { WebhookDeliveryEvent } from "@macrograph/module-github/Definition";
import GitHubDeployment from "@macrograph/module-github/Deployment/Webhook";
import HttpClientModule from "@macrograph/module-http-client";
import HttpClientDeployment from "@macrograph/module-http-client/Deployment";
import KofiModule from "@macrograph/module-kofi";
import { Payment } from "@macrograph/module-kofi/Definition";
import KofiDeployment from "@macrograph/module-kofi/Deployment/Webhook";
import OpenCodeModule from "@macrograph/module-opencode";
import { RequestFailure as OpenCodeFailure } from "@macrograph/module-opencode/Definition";
import { makeLayer as makeOpenCodeLayer } from "@macrograph/module-opencode/Engine";
import SendblueModule from "@macrograph/module-sendblue";
import { InboundMessage } from "@macrograph/module-sendblue/Definition";
import SendblueDeployment from "@macrograph/module-sendblue/Deployment/Webhook";
import TwitchModule from "@macrograph/module-twitch";
import { SubscriptionEvent } from "@macrograph/module-twitch/Definition";
import TwitchDeployment from "@macrograph/module-twitch/Deployment/Webhook";
import UtilitiesModule from "@macrograph/module-utilities";
import { TickEvent } from "@macrograph/module-utilities/Definition";
import UtilitiesDeployment from "@macrograph/module-utilities/Deployment";
import { ExecutorModules } from "@macrograph/project-host";
import { Effect, Schema } from "effect";

import { apiDeployments, statelessModules } from "../modules/CloudModules.ts";

const [openai, elevenlabs, discord] = apiDeployments;
const openCode = Engine.deployment(
  OpenCodeModule,
  makeOpenCodeLayer({
    connectionTypes: ["managed", "remote"],
    resolve: () => Effect.fail(new OpenCodeFailure({ reason: "OpenCode runtime is unavailable" })),
  }),
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
