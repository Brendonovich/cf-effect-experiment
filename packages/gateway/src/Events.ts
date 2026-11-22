import { WebhookEventName } from "@macrograph/module-github/Definition";
import { SUBSCRIPTION_TYPES } from "@macrograph/module-twitch/EventSub";
import { Schema } from "effect";

/** Where an event came from. */
export const Source = Schema.Literals(["twitch", "github", "discord"]);
export type Source = typeof Source.Type;

/** One event the gateway received for a user, as stored and delivered. */
export interface Event {
  /** Increases with every event a user receives; resume streams and history after it. */
  readonly seq: number;
  readonly id: string;
  readonly source: Source;
  /** The connected account (Twitch user, GitHub account, Discord bot) the event arrived for. */
  readonly account: string;
  readonly type: string;
  readonly receivedAt: string;
  readonly data: unknown;
}

/** Twitch EventSub subscription types, subscribed per Twitch account. */
export const twitchEventTypes: ReadonlyArray<string> = SUBSCRIPTION_TYPES;

/** GitHub repository webhook events, subscribed per repository. */
export const githubEventTypes: ReadonlyArray<string> = WebhookEventName.literals;

export interface DiscordIntent {
  readonly id: string;
  readonly bit: number;
  readonly name: string;
  /** Privileged intents must also be enabled for the bot in the Discord developer portal. */
  readonly privileged: boolean;
}

/** Discord gateway intents a bot connection can request; every dispatch they cover is delivered. */
export const discordIntents: ReadonlyArray<DiscordIntent> = [
  { id: "guilds", bit: 0, name: "Servers", privileged: false },
  { id: "guild_members", bit: 1, name: "Members", privileged: true },
  { id: "guild_moderation", bit: 2, name: "Moderation", privileged: false },
  { id: "guild_voice_states", bit: 7, name: "Voice states", privileged: false },
  { id: "guild_presences", bit: 8, name: "Presences", privileged: true },
  { id: "guild_messages", bit: 9, name: "Server messages", privileged: false },
  { id: "guild_message_reactions", bit: 10, name: "Server reactions", privileged: false },
  { id: "direct_messages", bit: 12, name: "Direct messages", privileged: false },
  { id: "message_content", bit: 15, name: "Message content", privileged: true },
];

export const discordIntentBits = (ids: ReadonlyArray<string>) =>
  discordIntents
    .filter((intent) => ids.includes(intent.id))
    .reduce((bits, intent) => bits | (1 << intent.bit), 0);

/** What a user's gateway listens for. */
export const Subscriptions = Schema.Struct({
  /** Event types per Twitch account ID. */
  twitch: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  github: Schema.Array(
    Schema.Struct({
      /** The connected GitHub account that can see the repository. */
      account: Schema.String,
      installationId: Schema.String,
      repositoryId: Schema.String,
      owner: Schema.String,
      repository: Schema.String,
      events: Schema.Array(Schema.String),
    }),
  ),
  discord: Schema.NullOr(
    Schema.Struct({
      /** The bot's token, which the gateway keeps to hold its connection open. */
      token: Schema.String,
      intents: Schema.Array(Schema.String),
    }),
  ),
});
export type Subscriptions = typeof Subscriptions.Type;

export const emptySubscriptions: Subscriptions = { twitch: {}, github: [], discord: null };

/** Whether `filter` (event types, `source.type` or `source.*`; empty for all) selects an event. */
export const matches = (filter: ReadonlyArray<string>, event: Pick<Event, "source" | "type">) =>
  filter.length === 0 ||
  filter.some(
    (pattern) =>
      pattern === `${event.source}.*` ||
      pattern === `${event.source}.${event.type}` ||
      pattern === event.type,
  );
