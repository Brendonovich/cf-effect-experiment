import { Fiber, HashMap, Option, Scope, Semaphore, Stream, SubscriptionRef } from "effect";
import * as Effect from "effect/Effect";
import { Socket } from "effect/unstable/socket";

import type { AccountId } from "./Definition.ts";

import { buildCondition, EventSubMessage, EventSubSocket, SubscriptionEvent } from "./EventSub.ts";
import { definitionsFor, helixError, type Make, type State } from "./EventSubImplementation.ts";

type Entry = { readonly lock: Semaphore.Semaphore } & (
  | { readonly state: "connecting" }
  | {
      readonly state: "connected";
      readonly id: string;
      readonly fiber: Fiber.Fiber<void, EventSubSocket.ConnectionFailed>;
    }
);

export const make: Make<Socket.WebSocketConstructor> = (context) =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(HashMap.empty<AccountId, Entry>());
    const socketContext = yield* Effect.context<Scope.Scope | Socket.WebSocketConstructor>();

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
      yield* Fiber.interrupt(entry.value.fiber);
      yield* Effect.logInfo("EventSub WebSocket disconnected", {
        accountId: id,
        sessionId: entry.value.id,
      });
    });

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
        yield* Effect.logDebug("Loading Twitch Helix client", { accountId: id });
        const helix = yield* context.getHelix(id);

        yield* Effect.gen(function* () {
          yield* SubscriptionRef.update(state, (current) =>
            HashMap.set(current, id, { lock, state: "connecting" }),
          );
          yield* Effect.logInfo("EventSub WebSocket state changed to connecting", {
            accountId: id,
          });

          const socket = yield* Effect.gen(function* () {
            const socket = yield* EventSubSocket.make;
            yield* Effect.logInfo("EventSub WebSocket handshake completed", {
              accountId: id,
              sessionId: socket.id,
            });
            const existingSubscriptions = yield* helixError(
              helix.eventsub.listSubscriptions({ query: {} }),
            );
            yield* Effect.logInfo("Listed Twitch EventSub subscriptions", {
              accountId: id,
              count: existingSubscriptions.data.length,
            });

            const disconnectedSubscriptions = existingSubscriptions.data.filter(
              (subscription) => subscription.status === "websocket_disconnected",
            );
            yield* Effect.logInfo("Removing disconnected Twitch EventSub subscriptions", {
              accountId: id,
              count: disconnectedSubscriptions.length,
            });
            yield* Effect.all(
              disconnectedSubscriptions.map((subscription) =>
                helixError(
                  helix.eventsub.deleteSubscription({ query: { id: subscription.id } }),
                ).pipe(
                  Effect.tap(() =>
                    Effect.logDebug("Deleted disconnected Twitch EventSub subscription", {
                      accountId: id,
                      subscriptionId: subscription.id,
                    }),
                  ),
                  Effect.catch((error) =>
                    Effect.logWarning("Failed to delete Twitch EventSub subscription", error, {
                      accountId: id,
                      subscriptionId: subscription.id,
                    }),
                  ),
                  Effect.ignore,
                ),
              ),
              { concurrency: 3 },
            );

            const definitions = definitionsFor(yield* context.getSubscriptions(id));
            yield* Effect.logInfo("Creating Twitch EventSub subscriptions for WebSocket", {
              accountId: id,
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
                      transport: { method: "websocket", session_id: socket.id },
                    },
                  }),
                ).pipe(
                  Effect.tap(() =>
                    Effect.logInfo("Created Twitch EventSub subscription", {
                      accountId: id,
                      sessionId: socket.id,
                      subscriptionType: definition.type,
                    }),
                  ),
                  Effect.catch((error) =>
                    Effect.logWarning("Failed to create Twitch EventSub subscription", error, {
                      accountId: id,
                      sessionId: socket.id,
                      subscriptionType: definition.type,
                    }),
                  ),
                ),
              ),
              { concurrency: 5 },
            );

            const fiber = yield* socket.stream.pipe(
              Stream.filter((event) => EventSubMessage.isType(event, "notification")),
              Stream.filterMap((event) =>
                SubscriptionEvent.decodeAny({
                  _tag: event.payload.subscription.type,
                  ...event.payload.event,
                }),
              ),
              Stream.tap((event) =>
                Effect.logDebug("Received Twitch EventSub notification", {
                  accountId: id,
                  eventType: event._tag,
                  sessionId: socket.id,
                }),
              ),
              Stream.runForEach(context.emit),
              Effect.onExit((exit) =>
                Effect.logInfo("EventSub WebSocket listener stopped", {
                  accountId: id,
                  exit,
                  sessionId: socket.id,
                }),
              ),
              Effect.ensuring(
                Effect.gen(function* () {
                  yield* SubscriptionRef.update(state, (current) =>
                    HashMap.remove(current, id),
                  ).pipe(lock.withPermit);
                  yield* Effect.logInfo("EventSub WebSocket state removed", { accountId: id });
                }),
              ),
              Effect.forkScoped,
            );

            return { id: socket.id, fiber };
          }).pipe(
            Effect.forkScoped,
            Effect.provideContext(socketContext),
            Effect.flatMap(Fiber.join),
          );

          yield* SubscriptionRef.update(state, (current) =>
            HashMap.set(current, id, {
              lock,
              state: "connected",
              id: socket.id,
              fiber: socket.fiber,
            }),
          );
          yield* Effect.logInfo("EventSub WebSocket state changed to connected", {
            accountId: id,
            sessionId: socket.id,
          });
        }).pipe(
          lock.withPermit,
          Effect.tapError((error) =>
            Effect.gen(function* () {
              yield* Effect.logError("EventSub WebSocket connection failed", error, {
                accountId: id,
              });
              yield* SubscriptionRef.update(state, (current) => HashMap.remove(current, id));
            }),
          ),
        );
      }),
      disconnect,
    };
  });
