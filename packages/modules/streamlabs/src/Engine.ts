import { Effect, Layer, Queue, Semaphore, Stream } from "effect";

import { ClientRpcs, type ClientState, StreamlabsEngine, StreamlabsFailure } from "./Definition.ts";
import { decodeEvent } from "./Events.ts";
import { SocketFactory, socketLayer } from "./Transport.ts";

export const layer = StreamlabsEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const factory = yield* SocketFactory;
    const lock = yield* Semaphore.make(1);
    const callbacks = yield* Queue.dropping<Effect.Effect<void>>(1024);
    yield* Stream.runForEach(Stream.fromQueue(callbacks), (effect) => effect).pipe(
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() => Queue.shutdown(callbacks).pipe(Effect.asVoid));
    let config = yield* mg.storage.get;
    let state: typeof ClientState.Type = {
      configured: !!config.token,
      enabled: config.enabled,
      status: "disconnected",
    };
    let close: (() => void) | undefined;
    let generation = 0;
    const stop = () => {
      generation++;
      close?.();
      close = undefined;
    };
    yield* Effect.addFinalizer(() => Effect.sync(stop));

    const start = Effect.fnUntraced(function* () {
      stop();
      state = { configured: !!config.token, enabled: config.enabled, status: "disconnected" };
      if (config.enabled && config.token)
        yield* Effect.try({
          try: () => {
            const current = generation;
            const socket = factory.create(config.token);
            const update = (status: (typeof ClientState.Type)["status"]) => {
              if (current !== generation) return;
              state = {
                configured: true,
                enabled: true,
                status,
                ...(status === "error" ? { error: "connection-failed" as const } : {}),
              };
              Queue.offerUnsafe(callbacks, mg.client.refresh);
            };
            const onConnect = () => update("connected");
            const onDisconnect = () => update("disconnected");
            const onError = () => update("error");
            const onEvent = (payload: unknown) => {
              if (current !== generation) return;
              const event = decodeEvent(payload);
              if (event)
                Queue.offerUnsafe(
                  callbacks,
                  Effect.suspend(() => (current === generation ? mg.emit(event) : Effect.void)),
                );
            };
            close = () => {
              socket.off("connect", onConnect);
              socket.off("disconnect", onDisconnect);
              socket.off("connect_error", onError);
              socket.off("event", onEvent);
              socket.disconnect();
            };
            socket.on("connect", onConnect);
            socket.on("disconnect", onDisconnect);
            socket.on("connect_error", onError);
            socket.on("event", onEvent);
            update("connecting");
            socket.connect();
          },
          catch: () => "connection-failed" as const,
        }).pipe(
          Effect.catchCause(() =>
            Effect.sync(() => {
              stop();
              state = { ...state, status: "error", error: "connection-failed" };
            }),
          ),
        );
      yield* mg.client.refresh;
    });
    const save = Effect.fnUntraced(function* (next: typeof StreamlabsEngine.Storage.Type) {
      yield* Effect.suspend(() => mg.storage.set(next)).pipe(
        Effect.catchCause(() => Effect.fail(new StreamlabsFailure({ reason: "storage-failed" }))),
      );
      config = next;
      yield* start();
    });
    yield* start();
    return StreamlabsEngine.of({
      resources: Layer.empty,
      rpcs: Layer.empty,
      client: {
        state: Effect.sync(() => state),
        rpcs: ClientRpcs.toLayer({
          StreamlabsConfigure: ({ token }) =>
            Effect.gen(function* () {
              if (token.length === 0 || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token))
                return yield* new StreamlabsFailure({ reason: "invalid-token" });
              yield* save({ token, enabled: true });
            }).pipe(lock.withPermit),
          StreamlabsSetEnabled: ({ enabled }) =>
            Effect.gen(function* () {
              if (enabled && !config.token)
                return yield* new StreamlabsFailure({ reason: "not-configured" });
              yield* save({ ...config, enabled });
            }).pipe(lock.withPermit),
          StreamlabsClear: () => save({ token: "", enabled: false }).pipe(lock.withPermit),
        }),
      },
    });
  }),
);

export default layer.pipe(Layer.provide(socketLayer));
