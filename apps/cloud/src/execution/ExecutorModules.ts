import GitHubModule from "@macrograph/module-github";
import { WebhookDelivery } from "@macrograph/module-github/Definition";
import GitHubDeployment from "@macrograph/module-github/Deployment/Webhook";
import HttpClientModule from "@macrograph/module-http-client";
import HttpClientDeployment from "@macrograph/module-http-client/Deployment";
import KofiModule from "@macrograph/module-kofi";
import { Payment } from "@macrograph/module-kofi/Definition";
import KofiDeployment from "@macrograph/module-kofi/Deployment/Webhook";
import TwitchModule from "@macrograph/module-twitch";
import { SubscriptionEvent } from "@macrograph/module-twitch/Definition";
import TwitchDeployment from "@macrograph/module-twitch/Deployment/Webhook";
import UtilitiesModule from "@macrograph/module-utilities";
import { TickEvent } from "@macrograph/module-utilities/Definition";
import UtilitiesDeployment from "@macrograph/module-utilities/Deployment";
import { ExecutorModules } from "@macrograph/project-host";
import { Schema } from "effect";

import { apiDeployments, statelessModules } from "../modules/CloudModules.ts";

const [openai, elevenlabs] = apiDeployments;

export const registry = ExecutorModules.make([
  ExecutorModules.entry(TwitchModule, SubscriptionEvent.Any, TwitchDeployment),
  ExecutorModules.entry(KofiModule, Payment, KofiDeployment),
  ExecutorModules.entry(HttpClientModule, Schema.Never, HttpClientDeployment),
  ExecutorModules.entry(GitHubModule, WebhookDelivery, GitHubDeployment),
  ExecutorModules.entry(UtilitiesModule, TickEvent, UtilitiesDeployment),
  ...statelessModules.map((module) => ExecutorModules.entry(module)),
  ExecutorModules.entry(openai.module, Schema.Never, openai),
  ExecutorModules.entry(elevenlabs.module, Schema.Never, elevenlabs),
]);
