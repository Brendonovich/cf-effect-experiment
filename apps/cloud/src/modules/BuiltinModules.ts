import { Engine, Module } from "@macrograph/module";
import DiscordDefault from "@macrograph/module-discord";
import ElevenLabsDefault from "@macrograph/module-elevenlabs";
import GitHubDefault from "@macrograph/module-github";
import GitHubWebhook from "@macrograph/module-github/Deployment/Webhook";
import HttpClientDefault from "@macrograph/module-http-client";
import HttpClientStandalone from "@macrograph/module-http-client/Deployment";
import JsonDefault from "@macrograph/module-json";
import KofiDefault from "@macrograph/module-kofi";
import KofiWebhook from "@macrograph/module-kofi/Deployment/Webhook";
import ListDefault from "@macrograph/module-list";
import LogicDefault from "@macrograph/module-logic";
import MathDefault from "@macrograph/module-math";
import OpenAIDefault from "@macrograph/module-openai";
import OpenCodeDefault from "@macrograph/module-opencode";
import SendblueDefault from "@macrograph/module-sendblue";
import SendblueWebhook from "@macrograph/module-sendblue/Deployment/Webhook";
import StringDefault from "@macrograph/module-string";
import TwitchDefault from "@macrograph/module-twitch";
import TwitchWebhook from "@macrograph/module-twitch/Deployment/Webhook";
import UtilitiesDefault from "@macrograph/module-utilities";
import UtilitiesStandalone from "@macrograph/module-utilities/Deployment";

/** The ids the cloud loads its built-in modules under. Every cloud host uses these. */
export const ids = {
  discord: Module.builtinId("discord"),
  elevenlabs: Module.builtinId("elevenlabs"),
  github: Module.builtinId("github"),
  httpClient: Module.builtinId("http-client"),
  json: Module.builtinId("json"),
  kofi: Module.builtinId("kofi"),
  list: Module.builtinId("list"),
  logic: Module.builtinId("logic"),
  math: Module.builtinId("math"),
  openai: Module.builtinId("openai"),
  opencode: Module.builtinId("opencode"),
  sendblue: Module.builtinId("sendblue"),
  string: Module.builtinId("string"),
  twitch: Module.builtinId("twitch"),
  utilities: Module.builtinId("utilities"),
} as const;

export const DiscordModule = Module.identify(ids.discord, DiscordDefault);
export const ElevenLabsModule = Module.identify(ids.elevenlabs, ElevenLabsDefault);
export const GitHubModule = Module.identify(ids.github, GitHubDefault);
export const HttpClientModule = Module.identify(ids.httpClient, HttpClientDefault);
export const JsonModule = Module.identify(ids.json, JsonDefault);
export const KofiModule = Module.identify(ids.kofi, KofiDefault);
export const ListModule = Module.identify(ids.list, ListDefault);
export const LogicModule = Module.identify(ids.logic, LogicDefault);
export const MathModule = Module.identify(ids.math, MathDefault);
export const OpenAIModule = Module.identify(ids.openai, OpenAIDefault);
export const OpenCodeModule = Module.identify(ids.opencode, OpenCodeDefault);
export const SendblueModule = Module.identify(ids.sendblue, SendblueDefault);
export const StringModule = Module.identify(ids.string, StringDefault);
export const TwitchModule = Module.identify(ids.twitch, TwitchDefault);
export const UtilitiesModule = Module.identify(ids.utilities, UtilitiesDefault);

export const GitHubWebhookDeployment: Engine.Identified<typeof GitHubWebhook> = Engine.identify(
  ids.github,
  GitHubWebhook,
);
export const HttpClientDeployment: Engine.Identified<typeof HttpClientStandalone> = Engine.identify(
  ids.httpClient,
  HttpClientStandalone,
);
export const KofiWebhookDeployment: Engine.Identified<typeof KofiWebhook> = Engine.identify(
  ids.kofi,
  KofiWebhook,
);
export const SendblueWebhookDeployment: Engine.Identified<typeof SendblueWebhook> = Engine.identify(
  ids.sendblue,
  SendblueWebhook,
);
export const TwitchWebhookDeployment: Engine.Identified<typeof TwitchWebhook> = Engine.identify(
  ids.twitch,
  TwitchWebhook,
);
export const UtilitiesDeployment: Engine.Identified<typeof UtilitiesStandalone> = Engine.identify(
  ids.utilities,
  UtilitiesStandalone,
);
