import { HttpEndpoint, HttpIngress } from "@macrograph/plugin";
import {
  Context,
  Clock,
  Effect,
  Exit,
  HashMap,
  Layer,
  Option,
  Redacted,
  Ref,
  Result,
  Schema,
  Semaphore,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { HttpClient } from "effect/unstable/http";

import { AppHelix } from "./AppHelix.ts";
import { isCatalogEvent } from "./Catalog.ts";
import { AccountId } from "./Definition.ts";
import { buildCondition, EventSubSocket, SubscriptionEvent } from "./EventSub.ts";
import {
  definitionsFor,
  helixError,
  listSubscriptions,
  type Make,
  type State,
} from "./EventSubImplementation.ts";
import { Helix } from "./Helix.ts";

export const EventSubEndpointMetadata = Schema.Struct({ accountId: AccountId });
export type EventSubEndpointMetadata = typeof EventSubEndpointMetadata.Type;

export const EventSubIngress = HttpIngress.make({
  id: "twitch:eventsub",
  pluginId: "twitch",
  displayName: "EventSub Webhook",
  method: "POST",
  metadata: EventSubEndpointMetadata,
  event: SubscriptionEvent.Any,
  configuration: Schema.Struct({ subscriptions: Schema.Array(Schema.String) }),
  mergeConfiguration: (current, next) => ({
    subscriptions: [...new Set([...current.subscriptions, ...next.subscriptions])],
  }),
  accepts: (configuration, eventType) => configuration.subscriptions.includes(eventType),
});

export const EventSubEndpoint = EventSubIngress;

export class VerificationError extends Schema.TaggedError<VerificationError>()(
  "VerificationError",
  { cause: Schema.Unknown },
) {}

export class SignatureVerifier extends Context.Service<
  SignatureVerifier,
  {
    readonly verify: (
      secret: Redacted.Redacted<string>,
      message: Uint8Array,
      signature: string,
    ) => Effect.Effect<boolean, VerificationError>;
  }
>()("@macrograph/plugin-twitch/WebhookEventSub/SignatureVerifier") {}

export type Request = HttpIngress.HttpRequest<EventSubEndpointMetadata>;
export type Response = HttpIngress.HttpResponse<SubscriptionEvent.Any>;

const Delivery = Schema.Struct({
  challenge: Schema.optional(Schema.String),
  subscription: Schema.Struct({
    id: Schema.String,
    status: Schema.String,
    type: Schema.String,
    version: Schema.String,
    condition: Schema.Record(Schema.String, Schema.String),
  }),
  event: Schema.optional(Schema.Unknown),
});

const decodeDelivery = Schema.decodeUnknownEffect(Schema.fromJsonString(Delivery));

const getHeader = (headers: Request["headers"], name: string) => {
  const expected = name.toLowerCase();
  return Object.entries(headers).find(([header]) => header.toLowerCase() === expected)?.[1];
};

const signedMessage = (id: string, timestamp: string, body: Uint8Array) => {
  const prefix = new TextEncoder().encode(id + timestamp);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix);
  message.set(body, prefix.length);
  return message;
};

const belongsToAccount = (condition: Readonly<Record<string, string>>, accountId: AccountId) => {
  const values = Object.values(condition);
  return values.length > 0 && values.every((value) => value === accountId);
};

const conditionsEqual = (
  current: Readonly<Record<string, string>>,
  desired: Readonly<Record<string, string>>,
) =>
  Object.keys(current).length === Object.keys(desired).length &&
  Object.entries(desired).every(([key, value]) => current[key] === value);

const decodeHex = (value: string): Uint8Array | undefined => {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    const byte = Number.parseInt(value.slice(index, index + 2), 16);
    if (!Number.isFinite(byte)) return undefined;
    bytes[index / 2] = byte;
  }
  return bytes;
};

export const layerWebCrypto = (crypto: globalThis.Crypto) =>
  Layer.succeed(SignatureVerifier)({
    verify: (secret, message, signature) => {
      const bytes = signature.startsWith("sha256=")
        ? decodeHex(signature.slice("sha256=".length))
        : undefined;
      if (bytes === undefined) return Effect.succeed(false);

      return Effect.tryPromise({
        try: () =>
          crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(Redacted.value(secret)),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"],
          ),
        catch: (cause) => new VerificationError({ cause }),
      }).pipe(
        Effect.flatMap((key) =>
          Effect.tryPromise({
            try: () =>
              crypto.subtle.verify("HMAC", key, Uint8Array.from(bytes), Uint8Array.from(message)),
            catch: (cause) => new VerificationError({ cause }),
          }),
        ),
      );
    },
  });

export const make: Make<AppHelix.AppCredentials | HttpClient.HttpClient | HttpEndpoint.Host> = (
  context,
) =>
  Effect.gen(function* () {
    const appCredentials = yield* AppHelix.AppCredentials;
    const httpClient = yield* HttpClient.HttpClient;
    const endpoints = yield* HttpEndpoint.Host;
    const state = yield* SubscriptionRef.make(
      HashMap.empty<AccountId, { readonly state: State }>(),
    );
    const operations = yield* Semaphore.make(1);
    const getHelix = yield* Effect.cached(
      AppHelix.makeAppClient.pipe(
        Effect.provideService(AppHelix.AppCredentials, appCredentials),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      ),
    );

    yield* Stream.runForEach(SubscriptionRef.changes(state), () => context.refresh).pipe(
      Effect.forkScoped,
    );

    const subscriptionsForAccount = Effect.fnUntraced(function* (
      accountId: AccountId,
      callback: string,
    ) {
      const helix = yield* getHelix;
      return (yield* listSubscriptions(helix)).filter(
        (subscription) =>
          subscription.transport.method === "webhook" &&
          subscription.transport.callback === callback &&
          belongsToAccount(subscription.condition, accountId),
      );
    });

    return {
      transport: "webhook" as const,
      state: Effect.gen(function* () {
        let current = yield* SubscriptionRef.get(state);
        const accountIds = yield* context.getAccountIds;
        for (const accountId of accountIds) {
          if (HashMap.has(current, accountId)) continue;
          const endpoint = yield* endpoints.get(EventSubEndpoint, accountId).pipe(
            Effect.catch(() =>
              Effect.logWarning("Failed to determine EventSub webhook state", {
                accountId,
              }).pipe(Effect.as(Option.none())),
            ),
          );
          if (Option.isSome(endpoint)) {
            current = HashMap.set(current, accountId, { state: "connected" });
          }
        }
        return current;
      }),
      connect: Effect.fnUntraced(function* (accountId, options) {
        yield* Effect.logInfo("EventSub webhook connect requested", {
          accountId,
        });
        yield* SubscriptionRef.update(state, (current) =>
          HashMap.set(current, accountId, { state: "connecting" }),
        );
        yield* Effect.logInfo("EventSub webhook state changed to connecting", {
          accountId,
        });

        yield* Effect.gen(function* () {
          const endpoint = yield* (
            options?.endpoint === undefined
              ? endpoints.ensure(EventSubEndpoint, {
                  instanceKey: accountId,
                  metadata: { accountId },
                })
              : Effect.succeed(options.endpoint)
          ).pipe(Effect.mapError((cause) => new EventSubSocket.ConnectionFailed({ cause })));
          yield* Effect.logInfo("Resolved EventSub webhook endpoint", {
            accountId,
            endpointUrl: endpoint.url,
          });
          const callbackUrl = yield* Effect.try({
            try: () => new URL(endpoint.url),
            catch: () =>
              new Helix.HelixError({
                reason: `Invalid EventSub callback URL: ${endpoint.url}`,
              }),
          });
          if (
            callbackUrl.protocol !== "https:" ||
            (callbackUrl.port !== "" && callbackUrl.port !== "443")
          ) {
            return yield* new Helix.HelixError({
              reason: `Twitch EventSub webhooks require a public HTTPS callback on port 443; received ${endpoint.url}`,
            });
          }
          const secret = yield* endpoints.secret(endpoint.id);
          const helix = yield* getHelix;
          const definitions = definitionsFor(yield* context.getSubscriptions(accountId));
          const existing = (yield* listSubscriptions(helix)).filter((subscription) => {
            if (
              subscription.transport.method !== "webhook" ||
              !belongsToAccount(subscription.condition, accountId)
            ) {
              return false;
            }
            if (subscription.transport.callback === endpoint.url) return true;
            if (!URL.canParse(subscription.transport.callback)) return false;
            const previousCallback = new URL(subscription.transport.callback);
            return (
              previousCallback.pathname === callbackUrl.pathname &&
              previousCallback.pathname.endsWith(`/${endpoint.id}`)
            );
          });
          yield* Effect.logInfo("Reconciling Twitch EventSub webhook subscriptions", {
            accountId,
            desiredCount: definitions.length,
            existingCount: existing.length,
            subscriptionTypes: definitions.map((definition) => definition.type),
          });

          const subscriptionsToDelete = existing.filter(
            (subscription) =>
              (subscription.transport.method === "webhook" &&
                subscription.transport.callback !== endpoint.url) ||
              !definitions.some(
                (definition) =>
                  definition.type === subscription.type &&
                  definition.version.toString() === subscription.version &&
                  conditionsEqual(subscription.condition, buildCondition(definition, accountId)),
              ),
          );
          yield* Effect.logInfo("Deleting stale Twitch EventSub webhook subscriptions", {
            accountId,
            count: subscriptionsToDelete.length,
          });
          yield* Effect.forEach(
            subscriptionsToDelete,
            (subscription) =>
              helixError(
                helix.eventsub.deleteSubscription({
                  query: { id: subscription.id },
                }),
              ).pipe(
                Effect.tap(() =>
                  Effect.logInfo("Deleted Twitch EventSub webhook subscription", {
                    accountId,
                    subscriptionId: subscription.id,
                    subscriptionType: subscription.type,
                  }),
                ),
              ),
            { discard: true },
          );

          const definitionsToCreate = definitions.filter(
            (definition) =>
              !existing.some(
                (subscription) =>
                  subscription.transport.method === "webhook" &&
                  subscription.transport.callback === endpoint.url &&
                  definition.type === subscription.type &&
                  definition.version.toString() === subscription.version &&
                  conditionsEqual(subscription.condition, buildCondition(definition, accountId)),
              ),
          );
          yield* Effect.logInfo("Creating Twitch EventSub webhook subscriptions", {
            accountId,
            count: definitionsToCreate.length,
          });
          yield* Effect.forEach(
            definitionsToCreate,
            (definition) =>
              helixError(
                helix.eventsub.createSubscription({
                  payload: {
                    type: definition.type,
                    version: definition.version.toString(),
                    condition: buildCondition(definition, accountId),
                    transport: {
                      method: "webhook",
                      callback: endpoint.url,
                      secret: Redacted.value(secret),
                    },
                  },
                }),
              ).pipe(
                Effect.tap(() =>
                  Effect.logInfo("Created Twitch EventSub webhook subscription", {
                    accountId,
                    subscriptionType: definition.type,
                  }),
                ),
                Effect.mapError(
                  (error) =>
                    new Helix.HelixError({
                      ...error,
                      reason: `Failed to create Twitch EventSub webhook subscription ${definition.type}: ${error.reason}${
                        error.status === 403
                          ? "; reauthorize the account with the required scopes for this Twitch application's Client ID and verify its channel roles"
                          : ""
                      }`,
                    }),
                ),
              ),
            { discard: true },
          );

          yield* SubscriptionRef.update(state, (current) =>
            HashMap.set(current, accountId, { state: "connected" }),
          );
          yield* Effect.logInfo("EventSub webhook state changed to connected", {
            accountId,
          });
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.gen(function* () {
                  yield* Effect.logError("EventSub webhook connection failed", { accountId });
                  yield* SubscriptionRef.update(state, (current) =>
                    HashMap.remove(current, accountId),
                  );
                })
              : Effect.void,
          ),
        );
      }, operations.withPermit),
      disconnect: Effect.fnUntraced(function* (accountId) {
        yield* Effect.logInfo("EventSub webhook disconnect requested", {
          accountId,
        });
        yield* Effect.gen(function* () {
          const endpoint = yield* endpoints.get(EventSubEndpoint, accountId).pipe(
            Effect.mapError(
              () => new Helix.HelixError({ reason: "Failed to resolve EventSub webhook endpoint" }),
            ),
          );
          if (Option.isNone(endpoint)) {
            yield* Effect.logInfo("No EventSub webhook endpoint to disconnect", { accountId });
            return;
          }
          const subscriptions = yield* subscriptionsForAccount(accountId, endpoint.value.url);
          const helix = yield* getHelix;
          yield* Effect.logInfo("Deleting Twitch EventSub webhook subscriptions", {
            accountId,
            count: subscriptions.length,
          });
          yield* Effect.forEach(
            subscriptions,
            (subscription) =>
              helixError(
                helix.eventsub.deleteSubscription({
                  query: { id: subscription.id },
                }),
              ),
            { discard: true },
          );
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError("Failed to disconnect EventSub webhook", { accountId, error }),
          ),
        );
        yield* SubscriptionRef.update(state, (current) =>
          HashMap.set(current, accountId, { state: "disconnected" }),
        );
        yield* context.refresh;
        yield* Effect.logInfo("EventSub webhook disconnected", { accountId });
      }, operations.withPermit),
    };
  });

export const handler = EventSubIngress.implement(
  Effect.gen(function* () {
    const appCredentials = yield* AppHelix.AppCredentials;
    const httpClient = yield* HttpClient.HttpClient;
    const endpoints = yield* HttpEndpoint.Host;
    const verifier = yield* SignatureVerifier;
    const subscriptions = yield* Ref.make<ReadonlyMap<AccountId, ReadonlyArray<string>>>(new Map());
    const delivered = yield* Ref.make<ReadonlySet<string>>(new Set());

    return Effect.gen(function* () {
      const lifecycleContext = yield* Effect.context<HttpEndpoint.Host | Scope.Scope>();
      const lifecycle = yield* make({
        getAccountIds: Ref.get(subscriptions).pipe(Effect.map((current) => [...current.keys()])),
        getHelix: () => Effect.die("Webhook EventSub uses Twitch app credentials"),
        getSubscriptions: (accountId) =>
          Ref.get(subscriptions).pipe(Effect.map((current) => current.get(accountId) ?? [])),
        emit: () => Effect.void,
        refresh: Effect.void,
      }).pipe(
        Effect.provideContext(lifecycleContext),
        Effect.provideService(AppHelix.AppCredentials, appCredentials),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.cached,
      );

      return {
        mount: Effect.fnUntraced(function* ({ endpoint, configuration }) {
          yield* Ref.update(subscriptions, (current) => {
            const next = new Map(current);
            next.set(endpoint.metadata.accountId, configuration.subscriptions);
            return next;
          });
          const eventSub = yield* lifecycle;
          yield* eventSub.connect(endpoint.metadata.accountId, { endpoint });
        }),
        unmount: Effect.fnUntraced(function* ({ endpoint }) {
          const eventSub = yield* lifecycle;
          yield* eventSub.disconnect(endpoint.metadata.accountId);
          yield* Ref.update(subscriptions, (current) => {
            const next = new Map(current);
            next.delete(endpoint.metadata.accountId);
            return next;
          });
        }),
        handle: Effect.fnUntraced(function* (request): Effect.fn.Return<Response> {
          const accountId = request.endpoint.metadata.accountId;
          yield* Effect.logInfo("Received Twitch EventSub webhook request", {
            accountId,
          });
          const secret = yield* endpoints.secret(request.endpoint.id);
          const messageId = getHeader(request.headers, "Twitch-Eventsub-Message-Id");
          const timestamp = getHeader(request.headers, "Twitch-Eventsub-Message-Timestamp");
          const signature = getHeader(request.headers, "Twitch-Eventsub-Message-Signature");
          const messageType = getHeader(request.headers, "Twitch-Eventsub-Message-Type");
          if (
            messageId === undefined ||
            timestamp === undefined ||
            signature === undefined ||
            messageType === undefined
          ) {
            yield* Effect.logWarning(
              "Twitch EventSub webhook request is missing required headers",
              {
                accountId,
              },
            );
            return { status: 400 };
          }
          const messageTimestamp = Date.parse(timestamp);
          const now = yield* Clock.currentTimeMillis;
          if (!Number.isFinite(messageTimestamp) || Math.abs(now - messageTimestamp) > 10 * 60_000)
            return { status: 403 };

          yield* Effect.logInfo("Processing Twitch EventSub webhook delivery", {
            accountId,
            messageId,
            messageType,
          });

          const verified = yield* verifier
            .verify(secret, signedMessage(messageId, timestamp, request.body), signature)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (!verified) {
            yield* Effect.logWarning("Twitch EventSub webhook signature verification failed", {
              accountId,
              messageId,
              messageType,
            });
            return { status: 403 };
          }

          const delivery = yield* decodeDelivery(new TextDecoder().decode(request.body)).pipe(
            Effect.option,
          );
          if (delivery._tag === "None") {
            yield* Effect.logWarning("Failed to decode Twitch EventSub webhook delivery", {
              accountId,
              messageId,
              messageType,
            });
            return { status: 400 };
          }
          if (
            !belongsToAccount(
              delivery.value.subscription.condition,
              request.endpoint.metadata.accountId,
            )
          )
            return { status: 400 };

          const definition = definitionsFor([delivery.value.subscription.type])[0];
          if (
            definition === undefined ||
            definition.version.toString() !== delivery.value.subscription.version ||
            !conditionsEqual(
              delivery.value.subscription.condition,
              buildCondition(definition, accountId),
            )
          )
            return { status: 400 };

          if (messageType === "webhook_callback_verification") {
            if (delivery.value.challenge === undefined) return { status: 400 };
            yield* Effect.logInfo("Accepted Twitch EventSub webhook callback verification", {
              accountId,
              messageId,
            });
            return {
              status: 200,
              body: delivery.value.challenge,
              contentType: "text/plain",
            };
          }

          if (messageType === "notification") {
            if (!request.configuration.subscriptions.includes(delivery.value.subscription.type))
              return { status: 204 };
            if (delivery.value.event === undefined) return { status: 400 };
            const duplicate = yield* Ref.modify(delivered, (current) => {
              if (current.has(messageId)) return [true, current] as const;
              const next = new Set(current);
              next.add(messageId);
              if (next.size > 2_048) {
                const oldest = next.values().next().value;
                if (oldest !== undefined) next.delete(oldest);
              }
              return [false, next] as const;
            });
            if (duplicate) return { status: 204 };
            const decoded = SubscriptionEvent.decodeAny({
              _tag: delivery.value.subscription.type,
              ...(typeof delivery.value.event === "object" && delivery.value.event !== null
                ? delivery.value.event
                : {}),
            });
            if (Result.isFailure(decoded)) return { status: 400 };
            if (!isCatalogEvent(decoded.success, accountId)) return { status: 400 };
            yield* Effect.logInfo("Accepted Twitch EventSub webhook notification", {
              accountId,
              eventType: decoded.success._tag,
              messageId,
            });
            return {
              status: 204,
              events: [{ event: decoded.success, eventId: messageId }],
            };
          }

          if (messageType === "revocation") {
            yield* Effect.logWarning("Received Twitch EventSub webhook revocation", {
              accountId,
              messageId,
              subscriptionType: delivery.value.subscription.type,
            });
            return { status: 204 };
          }
          return { status: 400 };
        }),
      };
    });
  }),
);

export { AppCredentials } from "./AppHelix.ts";
