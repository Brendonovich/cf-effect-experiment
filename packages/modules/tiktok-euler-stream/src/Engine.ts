import { Effect, Layer, Option, Queue, Schema, Semaphore, Stream } from "effect";

import {
  ClientRpcs,
  type ClientState,
  eventKinds,
  TikTokEngine,
  TikTokFailure,
  StateError,
} from "./Definition.ts";
import { decodeEvent } from "./Events.ts";
import { ClientFactory, clientLayer, type ClientEvent, type TikTokClient } from "./Transport.ts";

const Connected = Schema.Struct({ roomId: Schema.String });
const TransportError = Schema.Struct({ reason: StateError });
const usernamePattern = /^[a-zA-Z0-9_][a-zA-Z0-9_.]{0,23}$/;
const validKey = (key: string) => key.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(key);

export const layer = TikTokEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const factory = yield* ClientFactory;
    const lock = yield* Semaphore.make(1);
    const callbacks = yield* Queue.dropping<Effect.Effect<void>>(1024);
    yield* Stream.runForEach(Stream.fromQueue(callbacks), (effect) => effect).pipe(
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() => Queue.shutdown(callbacks).pipe(Effect.asVoid));
    // Coalesce invalidations independently so a full event queue cannot hide the latest state.
    const refreshes = yield* Queue.dropping<void>(1);
    yield* Stream.runForEach(Stream.fromQueue(refreshes), () => mg.client.refresh).pipe(
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() => Queue.shutdown(refreshes).pipe(Effect.asVoid));
    let config = yield* mg.storage.get;
    let state: typeof ClientState.Type;
    let generation = 0;
    let active:
      | {
          client: TikTokClient;
          listeners: Array<readonly [ClientEvent, (payload: unknown) => void]>;
        }
      | undefined;
    const refresh = () => Queue.offerUnsafe(refreshes, undefined);
    const disconnect = (client: TikTokClient) =>
      Effect.tryPromise({
        try: () => client.disconnect(),
        catch: () => "disconnect-failed" as const,
      }).pipe(
        Effect.timeout("5 seconds"),
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      );
    const stop = Effect.fnUntraced(function* () {
      generation++;
      const previous = active;
      active = undefined;
      if (!previous) return true;
      yield* Effect.sync(() => {
        for (const [name, listener] of previous.listeners) previous.client.off(name, listener);
      });
      return yield* disconnect(previous.client);
    });
    yield* Effect.addFinalizer(() => stop().pipe(Effect.asVoid));

    const start = Effect.fnUntraced(function* () {
      const stopped = yield* stop();
      state = {
        mode: config.mode,
        username: config.username,
        configured: !!config.username,
        apiKeyConfigured: !!config.apiKey,
        enabled: config.enabled,
        status: "disconnected",
        roomId: "",
        ...(!stopped ? { error: "disconnect-failed" as const } : {}),
      };
      if (config.enabled) {
        if (
          !usernamePattern.test(config.username) ||
          !validKey(config.apiKey) ||
          (config.mode === "managed" && !config.apiKey)
        ) {
          state = { ...state, status: "error", error: "not-configured" };
        } else
          yield* Effect.try({
            try: () => {
              const current = generation;
              const client = factory.create({
                username: config.username,
                apiKey: config.apiKey,
                mode: config.mode,
              });
              const listeners: Array<readonly [ClientEvent, (payload: unknown) => void]> = [];
              active = { client, listeners };
              const listen = (name: ClientEvent, listener: (payload: unknown) => void) => {
                listeners.push([name, listener]);
                client.on(name, listener);
              };
              const update = (
                status: (typeof ClientState.Type)["status"],
                roomId = state.roomId,
              ) => {
                if (current !== generation) return;
                state = {
                  mode: config.mode,
                  username: config.username,
                  configured: true,
                  apiKeyConfigured: !!config.apiKey,
                  enabled: true,
                  roomId,
                  status,
                  ...(status === "error" ? { error: "connection-failed" as const } : {}),
                };
                refresh();
              };
              const connected = (payload: unknown) => {
                if (current !== generation) return;
                const result = Schema.decodeUnknownOption(Connected)(payload);
                if (Option.isNone(result)) {
                  state = { ...state, status: "error", error: "invalid-payload" };
                  refresh();
                  return;
                }
                update("connected", result.value.roomId);
              };
              listen("connected", connected);
              listen("connecting", (payload) => {
                if (current !== generation) return;
                const result = Schema.decodeUnknownOption(Connected)(payload);
                if (Option.isSome(result)) update("connecting", result.value.roomId);
              });
              listen("roomInfo", (payload) => {
                if (current !== generation) return;
                const result = Schema.decodeUnknownOption(Connected)(payload);
                if (Option.isSome(result)) {
                  state = { ...state, roomId: result.value.roomId };
                  refresh();
                }
              });
              listen("disconnected", () => {
                if (current !== generation) return;
                // A failed connect often emits disconnected too; retain the actionable failure.
                if (state.status !== "error") update("disconnected", "");
              });
              listen("error", (payload) => {
                if (current !== generation) return;
                const result = Schema.decodeUnknownOption(TransportError)(payload);
                state = {
                  ...state,
                  status: "error",
                  error: Option.isSome(result) ? result.value.reason : "connection-failed",
                };
                refresh();
              });
              for (const kind of [
                ...eventKinds.filter((kind) => kind !== "giftStreak"),
                "social",
              ] as const) {
                listen(kind, (payload) => {
                  if (current !== generation) return;
                  const event = decodeEvent(kind, payload);
                  if (!event) {
                    if (kind !== "social") {
                      state = { ...state, error: "invalid-payload" };
                      refresh();
                    }
                    return;
                  }
                  const offered = Queue.offerUnsafe(
                    callbacks,
                    Effect.suspend(() => (current === generation ? mg.emit(event) : Effect.void)),
                  );
                  if (!offered) {
                    state = { ...state, error: "event-overflow" };
                    refresh();
                  }
                });
              }
              update("connecting", "");
              // Some connector requests cannot be interrupted mid-connect. Close again if an abandoned
              // attempt eventually succeeds, even after this project's scope has been released.
              void client.connect().then(
                (payload) => {
                  if (current === generation) {
                    if (payload !== undefined) connected(payload);
                  } else
                    void Promise.resolve()
                      .then(() => client.disconnect())
                      .catch(() => {});
                },
                () => {
                  if (current === generation) update("error");
                  void Promise.resolve()
                    .then(() => client.disconnect())
                    .catch(() => {});
                },
              );
            },
            catch: () => "connection-failed" as const,
          }).pipe(
            Effect.catchCause(() =>
              Effect.gen(function* () {
                yield* stop();
                state = { ...state, status: "error", error: "connection-failed" };
              }),
            ),
          );
      }
      yield* mg.client.refresh;
    });
    const save = Effect.fnUntraced(function* (next: typeof TikTokEngine.Storage.Type) {
      yield* Effect.suspend(() => mg.storage.set(next)).pipe(
        Effect.catchCause(() => Effect.fail(new TikTokFailure({ reason: "storage-failed" }))),
      );
      config = next;
      yield* start();
    });
    yield* start();
    return TikTokEngine.of({
      resources: Layer.empty,
      rpcs: Layer.empty,
      client: {
        state: Effect.sync(() => state),
        rpcs: ClientRpcs.toLayer({
          TikTokConfigure: ({ username, apiKey, mode }) =>
            Effect.gen(function* () {
              const name = username.trim().replace(/^@/, "");
              if (!usernamePattern.test(name))
                return yield* new TikTokFailure({ reason: "invalid-username" });
              if (apiKey !== undefined && !validKey(apiKey))
                return yield* new TikTokFailure({ reason: "invalid-api-key" });
              yield* save({
                username: name,
                apiKey: apiKey ?? config.apiKey,
                enabled: config.enabled,
                mode,
              });
            }).pipe(lock.withPermit),
          TikTokSetEnabled: ({ enabled }) =>
            Effect.gen(function* () {
              if (enabled && (!config.username || (config.mode === "managed" && !config.apiKey)))
                return yield* new TikTokFailure({ reason: "not-configured" });
              yield* save({ ...config, enabled });
            }).pipe(lock.withPermit),
          TikTokClear: () =>
            save({ mode: "connector", username: "", apiKey: "", enabled: false }).pipe(
              lock.withPermit,
            ),
        }),
      },
    });
  }),
);

export default layer.pipe(Layer.provide(clientLayer));
