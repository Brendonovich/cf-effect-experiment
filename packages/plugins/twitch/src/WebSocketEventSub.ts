import {
  Cause,
  Context,
  Deferred,
  Exit,
  Fiber,
  HashMap,
  Option,
  Result,
  Semaphore,
  Stream,
  SubscriptionRef,
  Tracer,
} from "effect";
import * as Effect from "effect/Effect";
import { Socket } from "effect/unstable/socket";

import type { AccountId, MissingCredential } from "./Definition.ts";

import { isCatalogEvent } from "./Catalog.ts";
import { buildCondition, EventSubMessage, EventSubSocket, SubscriptionEvent } from "./EventSub.ts";
import {
  definitionsFor,
  helixError,
  listSubscriptions,
  type Make,
  type State,
} from "./EventSubImplementation.ts";
import { Helix } from "./Helix.ts";

type ConnectError = EventSubSocket.ConnectionFailed | Helix.HelixError | MissingCredential;

type Entry = { readonly lock: Semaphore.Semaphore } & (
  | { readonly state: "connecting" }
  | {
      readonly state: "connected";
      readonly id: string;
      readonly fiber: Fiber.Fiber<void, ConnectError>;
    }
);

export const make: Make<Socket.WebSocketConstructor> = (context) =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(HashMap.empty<AccountId, Entry>());
    const scope = yield* Effect.scope;
    const webSocketConstructor = yield* Socket.WebSocketConstructor;
    const delivered = new Set<string>();
    const operations = yield* Semaphore.make(1);

    yield* Stream.runForEach(SubscriptionRef.changes(state), () => context.refresh).pipe(
      Effect.forkScoped,
    );

    const disconnect = Effect.fnUntraced(function* (id: AccountId) {
      yield* Effect.logInfo("EventSub WebSocket disconnect requested", { accountId: id });
      const entry = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(id)));
      if (Option.isNone(entry) || entry.value.state !== "connected") {
        yield* Effect.logInfo("No connected EventSub WebSocket to disconnect", {
          accountId: id,
        });
        return;
      }
      const active = entry.value;
      yield* Fiber.interrupt(active.fiber);
      yield* Effect.gen(function* () {
        const helix = yield* context.getHelix(id);
        const subscriptions = yield* listSubscriptions(helix);
        const sessionSubscriptions = subscriptions.filter(
          (subscription) =>
            subscription.transport.method === "websocket" &&
            subscription.transport.session_id === active.id,
        );
        yield* Effect.logInfo("Deleting EventSub WebSocket subscriptions", {
          accountId: id,
          sessionId: active.id,
          count: sessionSubscriptions.length,
        });
        yield* Effect.forEach(
          sessionSubscriptions,
          (subscription) =>
            helixError(helix.eventsub.deleteSubscription({ query: { id: subscription.id } })),
          { discard: true },
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Failed to delete disconnected EventSub subscriptions", {
            accountId: id,
            sessionId: active.id,
            error,
          }),
        ),
      );
      yield* Effect.logInfo("EventSub WebSocket disconnected", {
        accountId: id,
        sessionId: active.id,
      });
    }, operations.withPermit);

    const reconcile = Effect.fnUntraced(function* (id: AccountId) {
      const entry = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(id)));
      if (Option.isNone(entry) || entry.value.state !== "connected") return;

      yield* Effect.gen(function* () {
        const latest = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(id)));
        if (Option.isNone(latest) || latest.value.state !== "connected") return;
        const active = latest.value;
        const helix = yield* context.getHelix(id);
        const definitions = definitionsFor(yield* context.getSubscriptions(id));
        const existing = (yield* listSubscriptions(helix)).filter(
          (subscription) =>
            subscription.transport.method === "websocket" &&
            subscription.transport.session_id === active.id,
        );
        yield* Effect.logInfo("Reconciling Twitch EventSub subscriptions", {
          accountId: id,
          sessionId: active.id,
          subscriptionTypes: definitions.map((definition) => definition.type),
          existingSubscriptionTypes: existing.map((subscription) => subscription.type),
        });
        const matches = (
          subscription: (typeof existing)[number],
          definition: (typeof definitions)[number],
        ) =>
          definition.type === subscription.type &&
          definition.version.toString() === subscription.version &&
          Object.entries(buildCondition(definition, id)).every(
            ([key, value]) => subscription.condition[key] === value,
          );

        yield* Effect.forEach(
          existing.filter(
            (subscription) => !definitions.some((definition) => matches(subscription, definition)),
          ),
          (subscription) =>
            helixError(helix.eventsub.deleteSubscription({ query: { id: subscription.id } })),
          { discard: true },
        );
        yield* Effect.forEach(
          definitions.filter(
            (definition) => !existing.some((subscription) => matches(subscription, definition)),
          ),
          (definition) =>
            helixError(
              helix.eventsub.createSubscription({
                payload: {
                  type: definition.type,
                  version: definition.version.toString(),
                  condition: buildCondition(definition, id),
                  transport: { method: "websocket", session_id: active.id },
                },
              }),
            ),
          { discard: true },
        );
      }).pipe(entry.value.lock.withPermit);
    }, operations.withPermit);

    return {
      transport: "websocket" as const,
      state: SubscriptionRef.get(state).pipe(
        Effect.map(HashMap.map((entry): { readonly state: State } => ({ state: entry.state }))),
      ),
      connect: Effect.fnUntraced(function* (id: AccountId) {
        yield* Effect.logInfo("EventSub WebSocket connect requested", { accountId: id });
        const entry = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(id)));
        if (Option.isSome(entry)) {
          yield* Effect.logInfo(
            "EventSub WebSocket already active; waiting for current operation",
            {
              accountId: id,
              state: entry.value.state,
            },
          );
          yield* entry.value.lock.withPermit(Effect.void);
          yield* Effect.logInfo("Current EventSub WebSocket operation finished", { accountId: id });
          return;
        }

        const lock = yield* Semaphore.make(1);
        yield* Effect.logInfo("Loading Twitch Helix client for EventSub", { accountId: id });
        const helix = yield* context.getHelix(id);
        let connectionStage = "loading-subscriptions";

        yield* Effect.gen(function* () {
          yield* SubscriptionRef.update(state, (current) =>
            HashMap.set(current, id, { lock, state: "connecting" }),
          );
          yield* Effect.logInfo("EventSub WebSocket state changed to connecting", {
            accountId: id,
          });

          type EventSocket = Effect.Success<ReturnType<typeof EventSubSocket.make>>;
          const subscribe = (sessionId: string) =>
            Effect.gen(function* () {
              const definitions = definitionsFor(yield* context.getSubscriptions(id));
              connectionStage = "creating-subscriptions";
              yield* Effect.logInfo("Creating Twitch EventSub subscriptions for WebSocket", {
                accountId: id,
                sessionId,
                count: definitions.length,
                subscriptionTypes: definitions.map((definition) => definition.type),
              });
              yield* Effect.all(
                definitions.map((definition) =>
                  helixError(
                    helix.eventsub.createSubscription({
                      payload: {
                        type: definition.type,
                        version: definition.version.toString(),
                        condition: buildCondition(definition, id),
                        transport: { method: "websocket", session_id: sessionId },
                      },
                    }),
                  ).pipe(
                    Effect.tap(() =>
                      Effect.logInfo("Created Twitch EventSub subscription", {
                        accountId: id,
                        sessionId,
                        subscriptionType: definition.type,
                      }),
                    ),
                  ),
                ),
                { concurrency: 5 },
              );
            });
          const listen = (current: EventSocket) => {
            let reconnectUrl: string | undefined;
            return current.stream.pipe(
              Stream.timeoutOrElse({
                duration: `${current.keepaliveTimeoutSeconds + 5} seconds`,
                orElse: () =>
                  Stream.fail(new EventSubSocket.ConnectionFailed({ cause: "keepalive-timeout" })),
              }),
              Stream.takeUntilEffect((event) =>
                EventSubMessage.isType(event, "session_reconnect")
                  ? Effect.sync(() => {
                      reconnectUrl = event.payload.session.reconnect_url;
                      return true;
                    })
                  : Effect.succeed(false),
              ),
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  yield* Effect.logDebug("Received Twitch EventSub WebSocket message", {
                    accountId: id,
                    sessionId: current.id,
                    messageId: event.metadata.message_id,
                    messageType: event.metadata.message_type,
                  });
                  if (EventSubMessage.isType(event, "session_reconnect")) {
                    yield* Effect.logInfo("Reconnecting Twitch EventSub WebSocket", {
                      accountId: id,
                      sessionId: current.id,
                    });
                    return;
                  }
                  if (EventSubMessage.isType(event, "revocation")) {
                    yield* Effect.logWarning("Twitch revoked an EventSub subscription", {
                      accountId: id,
                      status: event.payload.subscription.status,
                      subscriptionId: event.payload.subscription.id,
                      subscriptionType: event.payload.subscription.type,
                    });
                    return yield* new EventSubSocket.ConnectionFailed({
                      cause: `subscription-revoked:${event.payload.subscription.status}`,
                    });
                  }
                  if (!EventSubMessage.isType(event, "notification")) return;
                  const notification = {
                    accountId: id,
                    sessionId: current.id,
                    messageId: event.metadata.message_id,
                    subscriptionId: event.payload.subscription.id,
                    subscriptionType: event.payload.subscription.type,
                  };
                  yield* Effect.logInfo("Received Twitch EventSub notification", notification);
                  if (delivered.has(event.metadata.message_id)) {
                    yield* Effect.logDebug(
                      "Ignoring duplicate EventSub notification",
                      notification,
                    );
                    return;
                  }
                  const definition = definitionsFor([event.payload.subscription.type])[0];
                  if (
                    definition === undefined ||
                    definition.version.toString() !== event.payload.subscription.version ||
                    Object.entries(buildCondition(definition, id)).some(
                      ([key, value]) => event.payload.subscription.condition[key] !== value,
                    )
                  ) {
                    yield* Effect.logWarning("Ignoring mismatched EventSub subscription", {
                      ...notification,
                      version: event.payload.subscription.version,
                      condition: event.payload.subscription.condition,
                    });
                    return;
                  }
                  const decoded = SubscriptionEvent.decodeAny({
                    _tag: event.payload.subscription.type,
                    ...(typeof event.payload.event === "object" && event.payload.event !== null
                      ? event.payload.event
                      : {}),
                  });
                  if (Result.isFailure(decoded)) {
                    yield* Effect.logWarning(
                      "Failed to decode Twitch EventSub notification",
                      notification,
                    );
                    return;
                  }
                  if (!isCatalogEvent(decoded.success, id)) {
                    yield* Effect.logWarning(
                      "EventSub notification did not match the event catalog",
                      notification,
                    );
                    return;
                  }
                  delivered.add(event.metadata.message_id);
                  if (delivered.size > 2_048) {
                    const oldest = delivered.values().next().value;
                    if (oldest !== undefined) delivered.delete(oldest);
                  }
                  yield* context.emit(decoded.success);
                  yield* Effect.logInfo("Emitted Twitch EventSub event", notification);
                }),
              ),
              Effect.flatMap(() =>
                reconnectUrl === undefined
                  ? new EventSubSocket.ConnectionFailed({ cause: "socket-closed" })
                  : Effect.succeed(reconnectUrl),
              ),
            );
          };
          const ready = yield* Deferred.make<string>();
          let initialized = false;
          const runSocket = (
            url: string | undefined,
            onOpen: (socket: EventSocket) => Effect.Effect<void, ConnectError>,
          ): Effect.Effect<void, ConnectError, Socket.WebSocketConstructor> =>
            Effect.scoped(
              Effect.gen(function* () {
                connectionStage = "opening-websocket";
                yield* Effect.logInfo("Opening Twitch EventSub WebSocket", {
                  accountId: id,
                  ...(url === undefined ? {} : { reconnectUrl: url }),
                });
                const socket = yield* EventSubSocket.make(url);
                yield* Effect.logInfo("EventSub WebSocket handshake completed", {
                  accountId: id,
                  sessionId: socket.id,
                });
                yield* initialized
                  ? onOpen(socket).pipe(
                      Effect.andThen(
                        SubscriptionRef.update(state, (current) => {
                          const entry = HashMap.get(current, id);
                          return Option.isSome(entry) && entry.value.state === "connected"
                            ? HashMap.set(HashMap.remove(current, id), id, {
                                ...entry.value,
                                id: socket.id,
                              })
                            : current;
                        }),
                      ),
                      lock.withPermit,
                    )
                  : onOpen(socket);
                connectionStage = "starting-listener";
                // Notifications are independent events with no per-message trace context.
                return yield* listen(socket).pipe(
                  Effect.updateContext<never, never>(Context.omit(Tracer.ParentSpan)),
                );
              }),
            ).pipe(
              Effect.flatMap((reconnectUrl) =>
                Effect.suspend(() =>
                  runSocket(reconnectUrl, (socket) =>
                    Effect.logInfo("Reconnecting Twitch EventSub WebSocket", {
                      accountId: id,
                      sessionId: socket.id,
                    }).pipe(Effect.andThen(subscribe(socket.id))),
                  ),
                ),
              ),
              Effect.catch((error) =>
                !initialized ||
                (error instanceof EventSubSocket.ConnectionFailed &&
                  typeof error.cause === "string" &&
                  error.cause.startsWith("subscription-revoked:"))
                  ? Effect.fail(error)
                  : Effect.logWarning("Recovering Twitch EventSub WebSocket", {
                      accountId: id,
                      error,
                    }).pipe(
                      Effect.andThen(Effect.sleep("5 seconds")),
                      Effect.andThen(
                        Effect.suspend(() =>
                          runSocket(undefined, (socket) => subscribe(socket.id)),
                        ),
                      ),
                    ),
              ),
            );
          const lifecycle = runSocket(undefined, (socket) =>
            Effect.gen(function* () {
              connectionStage = "listing-subscriptions";
              const existingSubscriptions = yield* listSubscriptions(helix);
              yield* Effect.logInfo("Listed Twitch EventSub subscriptions", {
                accountId: id,
                count: existingSubscriptions.length,
                subscriptions: JSON.stringify(existingSubscriptions, null, 2),
              });
              const disconnectedSubscriptions = existingSubscriptions.filter((subscription) =>
                subscription.status.startsWith("websocket_"),
              );
              connectionStage = "removing-stale-subscriptions";
              yield* Effect.forEach(
                disconnectedSubscriptions,
                (subscription) =>
                  helixError(helix.eventsub.deleteSubscription({ query: { id: subscription.id } })),
                { discard: true, concurrency: 3 },
              );
              yield* subscribe(socket.id);
              initialized = true;
              yield* Deferred.succeed(ready, socket.id);
            }),
          ).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
                ? Effect.logError("EventSub WebSocket listener stopped", {
                    accountId: id,
                    stage: connectionStage,
                    failure: Cause.pretty(exit.cause),
                  })
                : Effect.void,
            ),
            Effect.ensuring(
              SubscriptionRef.update(state, (current) => HashMap.remove(current, id)).pipe(
                lock.withPermit,
                Effect.andThen(
                  Effect.logInfo("EventSub WebSocket state removed", { accountId: id }),
                ),
              ),
            ),
            Effect.provideService(Socket.WebSocketConstructor, webSocketConstructor),
          );
          const fiber = yield* lifecycle.pipe(Effect.forkIn(scope));
          const sessionId = yield* Deferred.await(ready).pipe(
            Effect.raceFirst(
              Fiber.join(fiber).pipe(
                Effect.andThen(
                  Effect.fail(
                    new EventSubSocket.ConnectionFailed({ cause: "listener-stopped-before-ready" }),
                  ),
                ),
              ),
            ),
          );
          connectionStage = "publishing-connected-state";
          yield* SubscriptionRef.update(state, (current) =>
            HashMap.set(HashMap.remove(current, id), id, {
              lock,
              state: "connected",
              id: sessionId,
              fiber,
            }),
          );
          yield* Effect.logInfo("EventSub WebSocket state changed to connected", {
            accountId: id,
            sessionId,
          });
        }).pipe(
          lock.withPermit,
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.gen(function* () {
                  const failure = Cause.findFail(exit.cause);
                  const error = Result.isSuccess(failure) ? failure.success : undefined;
                  yield* Effect.logError("EventSub WebSocket connection failed", {
                    accountId: id,
                    stage: connectionStage,
                    failure: Cause.pretty(exit.cause),
                    error,
                  });
                  yield* SubscriptionRef.update(state, (current) => HashMap.remove(current, id));
                })
              : Effect.void,
          ),
        );
      }, operations.withPermit),
      reconcile,
      disconnect,
    };
  });
