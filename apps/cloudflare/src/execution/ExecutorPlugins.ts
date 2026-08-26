import HttpClientPlugin from "@macrograph/plugin-http-client";
import HttpClientDeployment from "@macrograph/plugin-http-client/Deployment";
import KofiPlugin from "@macrograph/plugin-kofi";
import { Payment } from "@macrograph/plugin-kofi/Definition";
import KofiDeployment from "@macrograph/plugin-kofi/Deployment/Webhook";
import TwitchPlugin from "@macrograph/plugin-twitch";
import { SubscriptionEvent } from "@macrograph/plugin-twitch/Definition";
import TwitchDeployment from "@macrograph/plugin-twitch/Deployment/Webhook";
import UtilitiesPlugin from "@macrograph/plugin-utilities";
import { TickEvent } from "@macrograph/plugin-utilities/Definition";
import UtilitiesDeployment from "@macrograph/plugin-utilities/Deployment";
import { ExecutorPlugins } from "@macrograph/project-host";
import { Schema } from "effect";

export const registry = ExecutorPlugins.make([
  ExecutorPlugins.entry(TwitchPlugin, SubscriptionEvent.Any, TwitchDeployment),
  ExecutorPlugins.entry(KofiPlugin, Payment, KofiDeployment),
  ExecutorPlugins.entry(HttpClientPlugin, Schema.Never, HttpClientDeployment),
  ExecutorPlugins.entry(UtilitiesPlugin, TickEvent, UtilitiesDeployment),
]);
