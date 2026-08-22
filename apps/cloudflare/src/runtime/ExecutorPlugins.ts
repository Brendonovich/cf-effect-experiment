import KofiPlugin from "@macrograph/plugin-kofi";
import { Payment } from "@macrograph/plugin-kofi/Definition";
import KofiDeployment from "@macrograph/plugin-kofi/Deployment/Webhook";
import TwitchPlugin from "@macrograph/plugin-twitch";
import { SubscriptionEvent } from "@macrograph/plugin-twitch/Definition";
import TwitchDeployment from "@macrograph/plugin-twitch/Deployment/Webhook";
import { ExecutorPlugins } from "@macrograph/project-host";

export const registry = ExecutorPlugins.make([
  ExecutorPlugins.entry(TwitchPlugin, SubscriptionEvent.Any, TwitchDeployment),
  ExecutorPlugins.entry(KofiPlugin, Payment, KofiDeployment),
]);
