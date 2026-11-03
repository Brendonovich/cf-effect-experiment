import * as Cloudflare from "@alchemy.run/cloudflare";
import { Events } from "@macrograph/gateway";
import { HttpIngressRuntime } from "@macrograph/http-ingress";
import { HttpEndpoint } from "@macrograph/module";
import { Gateway as DiscordGateway, gatewayLayer } from "@macrograph/module-discord/Gateway";
import {
  InstallationId,
  RepositoryId,
  WebhookEventName,
  WebhookId,
} from "@macrograph/module-github/Definition";
import { WebhookIngress } from "@macrograph/module-github/Webhook";
import { AccountId } from "@macrograph/module-twitch/Definition";
import { EventSubIngress, layerWebCrypto } from "@macrograph/module-twitch/EventSub/Webhook";
import * as HttpIngress from "@macrograph/module/HttpIngress";
import { Effect, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServerRequest, HttpServerResponse } from "effect/http";

import { appCredentialsLayerFromEnvironment } from "../GitHubCredentials.ts";
import { DurableObjectHttpEndpointHost } from "../ingress/DurableObjectHttpEndpointHost.ts";
import { httpIngressDeployments } from "../modules/CloudModules.ts";
import { AppCredentialsLayer as TwitchAppCredentialsLayer } from "../TwitchCredentials.ts";
import { EventLog } from "./EventLog.ts";

export interface ConfigureRequest {
  readonly userId: string;
  /** Where providers deliver webhooks: IngressWorker's public origin. */
  readonly publicOrigin: string;
  readonly subscriptions: Omit<Events.Subscriptions, "discord"> & {
    /** A `null` token keeps the stored one. */
    readonly discord: {
      readonly token: string | null;
      readonly intents: ReadonlyArray<string>;
    } | null;
  };
}

export class MissingDiscordToken extends Schema.TaggedError<MissingDiscordToken>()(
  "GatewayMissingDiscordToken",
  {},
) {}

export interface IngressRequest {
  readonly endpointId: string;
  readonly method: string;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  readonly body: Uint8Array;
}

export interface IngressResponse {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
}

export type DiscordStatus = "off" | "connecting" | "connected" | "error";

export interface Status {
  readonly subscriptions: {
    readonly twitch: Readonly<Record<string, ReadonlyArray<string>>>;
    readonly github: Events.Subscriptions["github"];
    /** The bot token is never returned once stored. */
    readonly discord: {
      readonly bot: string | null;
      readonly intents: ReadonlyArray<string>;
    } | null;
  };
  readonly discord: { readonly status: DiscordStatus; readonly error: string | null };
  /** Why the last subscription change could not be applied, if it failed. */
  readonly error: string | null;
}

export interface WebhookView {
  readonly id: string;
  readonly url: string;
  readonly events: ReadonlyArray<string>;
  readonly createdAt: string;
}

export interface GatewayDOShape {
  readonly configure: (request: ConfigureRequest) => Effect.Effect<Status, MissingDiscordToken>;
  readonly status: () => Effect.Effect<Status>;
  readonly ingress: (request: IngressRequest) => Effect.Effect<IngressResponse>;
  readonly events: (request: {
    readonly after?: number;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<Events.Event>>;
  readonly webhooks: () => Effect.Effect<ReadonlyArray<WebhookView>>;
  /** Returns the new webhook with its signing secret, which is not shown again. */
  readonly addWebhook: (request: {
    readonly url: string;
    readonly events: ReadonlyArray<string>;
  }) => Effect.Effect<WebhookView & { readonly secret: string }>;
  readonly removeWebhook: (id: string) => Effect.Effect<boolean>;
  readonly deliveries: (
    webhookId?: string,
  ) => Effect.Effect<ReadonlyArray<EventLog.DeliveryRecord>>;
}

const configKey = "gateway:config";
const watchdogMs = 60_000;
const pruneEveryMs = 60 * 60 * 1000;

const StoredConfig = Schema.Struct({
  userId: Schema.String,
  publicOrigin: Schema.String,
  subscriptions: Events.Subscriptions,
  manifest: HttpIngress.Manifest,
  error: Schema.NullOr(Schema.String),
});
type StoredConfig = typeof StoredConfig.Type;

/** A Discord bot token's first segment is the bot's user ID in base64. */
export const discordBotId = (token: string) => {
  try {
    const segment = token.split(".")[0] ?? "";
    const decoded = atob(segment.replaceAll("-", "+").replaceAll("_", "/"));
    return /^\d+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
};

const sseFrame = (event: Events.Event) =>
  `id: ${event.seq}\nevent: event\ndata: ${JSON.stringify(event)}\n\n`;

const [twitchDeployment, , githubDeployment] = httpIngressDeployments;

/**
 * One user's always-on event listener. It keeps Twitch EventSub and GitHub repository webhooks
 * subscribed for the user's accounts, holds a Discord bot's gateway connection open, verifies
 * and records every event, streams them to connected clients, and delivers them to the user's
 * webhooks with retries.
 */
export default class GatewayDO extends Cloudflare.DurableObject<GatewayDO, GatewayDOShape>()(
  "GatewayDO",
) {}

export const GatewayDOLayer = GatewayDO.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const workerEnvironment = yield* Cloudflare.WorkerEnvironment;
    const storage = state.raw.storage;
    let config: StoredConfig | undefined;
    const endpointHostLayer = DurableObjectHttpEndpointHost.layer({
      namespace: "gateway",
      makeUrl: (id) =>
        `${config?.publicOrigin ?? "http://localhost:1338"}/gateway/${config?.userId ?? "unknown"}/${id}`,
    });

    return Effect.gen(function* () {
      const endpointHost = yield* HttpEndpoint.Host;
      const discordGateway = yield* DiscordGateway;
      const registry = yield* HttpIngress.makeRegistry([
        { moduleId: twitchDeployment.moduleId, handlers: twitchDeployment.httpIngress.handlers },
        { moduleId: githubDeployment.moduleId, handlers: githubDeployment.httpIngress.handlers },
      ]).pipe(Effect.provide(layerWebCrypto(globalThis.crypto)), Effect.orDie);
      const runtime = yield* HttpIngressRuntime.make(
        [twitchDeployment, githubDeployment],
        registry,
        endpointHost,
      ).pipe(Effect.orDie);
      const log = EventLog.make({
        exec: (query, ...bindings) => storage.sql.exec(query, ...bindings),
      });

      const loaded = yield* Effect.promise(() => storage.get(configKey));
      if (loaded !== undefined)
        config = yield* Schema.decodeUnknownEffect(StoredConfig)(loaded).pipe(
          Effect.orElseSucceed(() => undefined),
        );

      // ---- Live streams ----

      const streams = new Set<(event: Events.Event) => void>();

      // ---- Alarms: deliveries, the Discord watchdog, and pruning ----

      let lastPrune = 0;
      const scheduleAlarm = async (at: number) => {
        const current = await storage.getAlarm();
        if (current === null || current > at) await storage.setAlarm(at);
      };
      const nextAlarm = () => {
        const candidates = [
          log.nextDueAt(),
          config?.subscriptions.discord == null ? undefined : Date.now() + watchdogMs,
          lastPrune === 0 ? undefined : lastPrune + pruneEveryMs,
        ].filter((value): value is number => value !== undefined);
        return candidates.length === 0 ? undefined : Math.min(...candidates);
      };

      const record = (input: Omit<Events.Event, "seq" | "receivedAt">) => {
        const stored = log.append(input);
        if (stored === undefined) return;
        for (const send of streams) send(stored);
        const due = log.nextDueAt();
        if (due !== undefined) void scheduleAlarm(due);
      };

      // ---- Discord ----

      let discord:
        | {
            readonly key: string;
            readonly stop: () => void;
            status: DiscordStatus;
            error: string | null;
          }
        | undefined;

      const syncDiscord = () => {
        const subscription = config?.subscriptions.discord ?? null;
        const key = subscription === null ? "" : JSON.stringify(subscription);
        if (discord?.key === key && discord.status !== "error") return;
        discord?.stop();
        discord = undefined;
        if (subscription === null) return;
        const bot = discordBotId(subscription.token) ?? "bot";
        const current = {
          key,
          stop: () => {},
          status: "connecting" as DiscordStatus,
          error: null as string | null,
        };
        discord = current;
        current.stop = discordGateway.start({
          token: subscription.token,
          messageContent: false,
          intents: Events.discordIntentBits(subscription.intents),
          onStatus: (status, error) => {
            current.status =
              status === "connected" ? "connected" : status === "error" ? "error" : "connecting";
            current.error = error ?? null;
          },
          onMessage: () => {},
          onDispatch: (type, data) =>
            record({ id: crypto.randomUUID(), source: "discord", account: bot, type, data }),
        });
      };

      // ---- Subscriptions ----

      const desiredManifest = (subscriptions: Events.Subscriptions) =>
        Effect.all([
          HttpIngress.manifest(
            twitchDeployment.moduleId,
            Object.entries(subscriptions.twitch).flatMap(([accountId, types]) =>
              types.length === 0
                ? []
                : [
                    EventSubIngress.require({
                      instanceKey: accountId,
                      metadata: { accountId: AccountId.make(accountId) },
                      configuration: { subscriptions: types },
                    }),
                  ],
            ),
          ),
          HttpIngress.manifest(
            githubDeployment.moduleId,
            subscriptions.github.flatMap((repository) => {
              const events = repository.events.filter(Schema.is(WebhookEventName));
              return events.length === 0
                ? []
                : [
                    WebhookIngress.require({
                      instanceKey: `${repository.installationId}:${repository.repositoryId}`,
                      displayName: `${repository.owner}/${repository.repository}`,
                      metadata: {
                        webhookId: WebhookId.make(
                          `gateway:${repository.installationId}:${repository.repositoryId}`,
                        ),
                        installationId: InstallationId.make(repository.installationId),
                        repositoryId: RepositoryId.make(repository.repositoryId),
                        owner: repository.owner,
                        repository: repository.repository,
                      },
                      configuration: { events },
                    }),
                  ];
            }),
          ),
        ]).pipe(Effect.map((manifests) => manifests.flat()));

      const status = (): Status => {
        const subscriptions = config?.subscriptions ?? Events.emptySubscriptions;
        return {
          subscriptions: {
            twitch: subscriptions.twitch,
            github: subscriptions.github,
            discord:
              subscriptions.discord === null
                ? null
                : {
                    bot: discordBotId(subscriptions.discord.token),
                    intents: subscriptions.discord.intents,
                  },
          },
          discord:
            discord === undefined
              ? { status: "off", error: null }
              : { status: discord.status, error: discord.error },
          error: config?.error ?? null,
        };
      };

      const configure = (request: ConfigureRequest) =>
        Effect.gen(function* () {
          const previous = config?.manifest ?? [];
          const discordToken =
            request.subscriptions.discord === null
              ? null
              : (request.subscriptions.discord.token ?? config?.subscriptions.discord?.token);
          if (discordToken === undefined) return yield* new MissingDiscordToken();
          const subscriptions: Events.Subscriptions = {
            ...request.subscriptions,
            discord:
              request.subscriptions.discord === null || discordToken === null
                ? null
                : { token: discordToken, intents: request.subscriptions.discord.intents },
          };
          config = {
            userId: request.userId,
            publicOrigin: request.publicOrigin,
            subscriptions,
            manifest: previous,
            error: null,
          };
          const desired = yield* desiredManifest(subscriptions).pipe(Effect.orDie);
          const error = yield* runtime.reconcile(previous, desired).pipe(
            Effect.as(null),
            Effect.catchCause((cause) =>
              Effect.logWarning("Gateway subscriptions failed to apply", cause).pipe(
                Effect.as(
                  "Some subscriptions could not be created. Check the accounts' permissions and try again.",
                ),
              ),
            ),
          );
          config = { ...config, manifest: error === null ? desired : previous, error };
          yield* Effect.promise(() => storage.put(configKey, config));
          syncDiscord();
          const at = nextAlarm();
          if (at !== undefined) yield* Effect.promise(() => scheduleAlarm(at));
          return status();
        });

      const ingress = (request: IngressRequest) =>
        Effect.gen(function* () {
          const endpoint = yield* endpointHost
            .lookup(HttpEndpoint.Id.make(request.endpointId))
            .pipe(Effect.orElseSucceed(() => undefined));
          if (endpoint === undefined || endpoint._tag === "None") return { status: 404 };
          const entry = (config?.manifest ?? []).find(
            (candidate) =>
              candidate.handlerId === endpoint.value.schema.id &&
              candidate.instanceKey === endpoint.value.instanceKey,
          );
          if (entry === undefined) return { status: 404 };
          const response = yield* runtime.handle({
            endpoint: endpoint.value,
            configuration: entry.configuration,
            method: request.method,
            headers: Object.fromEntries(request.headers),
            body: request.body,
          });
          for (const event of response.events) {
            if (!(yield* runtime.allows(entry, event))) continue;
            const payload = event.payload as Readonly<Record<string, unknown>> | null;
            if (entry.moduleId === githubDeployment.moduleId) {
              const delivery = payload ?? {};
              record({
                id: `github:${String(delivery.deliveryId ?? crypto.randomUUID())}`,
                source: "github",
                account: `${String(delivery.owner)}/${String(delivery.repository)}`,
                type: String(delivery.event),
                data: {
                  action: delivery.action,
                  sender: delivery.sender,
                  payload: delivery.payload,
                },
              });
            } else
              record({
                id: `twitch:${event.eventId ?? crypto.randomUUID()}`,
                source: "twitch",
                account: entry.instanceKey,
                type: event.eventType,
                data: payload,
              });
          }
          return {
            status: response.status,
            ...(response.body === undefined ? {} : { body: response.body }),
            ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
          } satisfies IngressResponse;
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Gateway ingress failed", cause).pipe(Effect.as({ status: 400 })),
          ),
        );

      const viewWebhook = (webhook: EventLog.Webhook): WebhookView => ({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        createdAt: webhook.createdAt,
      });

      // After an eviction, reconnect Discord and resume deliveries.
      syncDiscord();
      {
        const at = nextAlarm();
        if (at !== undefined) yield* Effect.promise(() => scheduleAlarm(at));
      }

      const shape: GatewayDOShape = {
        configure,
        status: () => Effect.sync(status),
        ingress,
        events: ({ after, limit }) =>
          Effect.sync(() =>
            after === undefined ? log.latest(limit).toReversed() : log.after(after, limit),
          ),
        webhooks: () => Effect.sync(() => log.webhooks().map(viewWebhook)),
        addWebhook: (request) =>
          Effect.sync(() => {
            const webhook = log.addWebhook(request);
            return { ...viewWebhook(webhook), secret: webhook.secret };
          }),
        removeWebhook: (id) => Effect.sync(() => log.removeWebhook(id)),
        deliveries: (webhookId) => Effect.sync(() => log.deliveries(webhookId)),
      };

      return {
        ...shape,
        alarm: () =>
          Effect.promise(async () => {
            for (const target of log.due())
              log.recordAttempt(target.delivery, await EventLog.deliver(target));
            if (Date.now() - lastPrune >= pruneEveryMs) {
              log.prune();
              lastPrune = Date.now();
            }
            syncDiscord();
            const at = nextAlarm();
            if (at !== undefined) await storage.setAlarm(Math.max(at, Date.now() + 1000));
          }),
        // `GET /stream?after=<seq>` streams events as server-sent events, starting after `after`
        // (or `Last-Event-ID`), or with only new events when neither is given.
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const url = new URL(request.url, "http://gateway");
          if (url.pathname !== "/stream") return HttpServerResponse.empty({ status: 404 });
          const resume = url.searchParams.get("after") ?? request.headers["last-event-id"];
          const after =
            resume !== undefined && resume !== null && /^\d+$/.test(resume)
              ? Number(resume)
              : (log.latest(1)[0]?.seq ?? 0);
          const encoder = new TextEncoder();
          let cleanup = () => {};
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              const write = (text: string) => {
                try {
                  controller.enqueue(encoder.encode(text));
                } catch {
                  cleanup();
                }
              };
              write(": connected\n\n");
              let cursor = after;
              for (;;) {
                const page = log.after(cursor, 500);
                for (const event of page) write(sseFrame(event));
                if (page.length < 500) break;
                cursor = page.at(-1)?.seq ?? cursor;
              }
              const send = (event: Events.Event) => write(sseFrame(event));
              streams.add(send);
              const keepalive = setInterval(() => write(": keepalive\n\n"), 25_000);
              cleanup = () => {
                streams.delete(send);
                clearInterval(keepalive);
              };
            },
            cancel() {
              cleanup();
            },
          });
          return HttpServerResponse.stream(
            Stream.fromReadableStream({ evaluate: () => body, onError: (cause) => cause }),
            {
              contentType: "text/event-stream",
              headers: { "cache-control": "no-cache", connection: "keep-alive" },
            },
          );
        }),
      };
    }).pipe(
      Effect.provide(endpointHostLayer),
      Effect.provide(gatewayLayer),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(appCredentialsLayerFromEnvironment(workerEnvironment)),
      Effect.provide(TwitchAppCredentialsLayer),
    );
  }),
);
