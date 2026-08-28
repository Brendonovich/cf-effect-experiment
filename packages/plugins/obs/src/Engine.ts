import type { Engine } from "@macrograph/plugin";
import {
  Crypto,
  Deferred,
  Fiber,
  HashMap,
  Option,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import * as Effect from "effect/Effect";
import { Socket } from "effect/unstable/socket";

import type { HighVolumeEvent } from "./Protocol.ts";

import {
  ClientRpcs,
  ConnectionFailed,
  OBSEngine,
  OBSSocket,
  RequestFailed,
  RuntimeRpcs,
  SocketNotFound,
} from "./Definition.ts";
import * as ObsEvent from "./Events.ts";
import * as ObsWebSocket from "./ObsWebSocket.ts";
import { SocketAddress } from "./Types.ts";

type SocketConfig = {
  readonly name?: string;
  readonly password?: string;
  readonly connectOnStartup: boolean;
  readonly highVolumeEvents?: ReadonlyArray<HighVolumeEvent>;
};
type SocketEntry = SocketConfig &
  (
    | { readonly state: "disconnected" }
    | { readonly state: "error"; readonly error: string }
    | {
        readonly state: "connecting";
        readonly connection: Fiber.Fiber<ObsWebSocket.Client, ConnectionFailed>;
        readonly canceled: Deferred.Deferred<void>;
      }
    | { readonly state: "connected"; readonly client: ObsWebSocket.Client }
  );

const isSafeAddress = (address: string) => {
  try {
    const url = new URL(address);
    return (
      (url.protocol === "ws:" || url.protocol === "wss:") &&
      url.username === "" &&
      url.password === "" &&
      address.length <= 2048
    );
  } catch {
    return false;
  }
};

const validateAddress = (address: SocketAddress): Effect.Effect<SocketAddress, ConnectionFailed> =>
  isSafeAddress(address)
    ? Effect.succeed(address)
    : Effect.fail(
        new ConnectionFailed({
          reason: "The OBS WebSocket address must be a credential-free ws:// or wss:// URL",
        }),
      );

const safeRequestComment = (comment: string | undefined, passwords: ReadonlyArray<string>) => {
  if (comment === undefined) return undefined;
  const withoutCredentials = comment.replace(
    /([a-z][a-z\d+.-]*:\/\/)[^/?#\s]*@/gi,
    "$1[redacted]@",
  );
  return passwords
    .reduce(
      (current, password) =>
        password === "" ? current : current.replaceAll(password, "[redacted]"),
      withoutCredentials,
    )
    .slice(0, 512);
};

export const make = Effect.fnUntraced(function* (mg: Engine.ContextOf<typeof OBSEngine>) {
  return yield* Effect.gen(function* () {
    const stored = yield* mg.storage.get;
    const entries = Object.entries(stored.sockets).flatMap(([address, config]) =>
      isSafeAddress(address)
        ? [
            [
              SocketAddress.make(address),
              {
                ...(config.name === undefined ? {} : { name: config.name }),
                ...(config.password === undefined ? {} : { password: config.password }),
                connectOnStartup: config.connectOnStartup,
                ...(config.highVolumeEvents === undefined
                  ? {}
                  : { highVolumeEvents: config.highVolumeEvents }),
                state: "disconnected" as const,
              },
            ] as const,
          ]
        : [],
    );
    const state = yield* SubscriptionRef.make(
      HashMap.fromIterable<SocketAddress, SocketEntry>(entries),
    );
    const settingsLock = yield* Semaphore.make(1);
    const stateLock = yield* Semaphore.make(1);
    const socketContext = yield* Effect.context<
      Crypto.Crypto | Scope.Scope | Socket.WebSocketConstructor
    >();

    yield* Stream.runForEach(SubscriptionRef.changes(state), () => mg.client.refresh).pipe(
      Effect.forkScoped,
    );

    const save = (sockets: HashMap.HashMap<SocketAddress, SocketEntry>) =>
      mg.storage
        .set({
          sockets: Object.fromEntries(
            [...sockets].map(([address, socket]) => [
              address,
              {
                ...(socket.name === undefined ? {} : { name: socket.name }),
                ...(socket.password === undefined ? {} : { password: socket.password }),
                connectOnStartup: socket.connectOnStartup,
                ...(socket.highVolumeEvents === undefined
                  ? {}
                  : { highVolumeEvents: socket.highVolumeEvents }),
              },
            ]),
          ),
        })
        .pipe(Effect.andThen(SubscriptionRef.set(state, sockets)));

    const setEntry = (address: SocketAddress, entry: SocketEntry) =>
      SubscriptionRef.update(state, HashMap.set(address, entry));

    const disconnect = Effect.fnUntraced(function* (address: SocketAddress) {
      const close = yield* Effect.gen(function* () {
        const entry = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
        if (
          Option.isNone(entry) ||
          (entry.value.state !== "connected" && entry.value.state !== "connecting")
        )
          return Effect.void;

        yield* setEntry(address, {
          ...(entry.value.name === undefined ? {} : { name: entry.value.name }),
          ...(entry.value.password === undefined ? {} : { password: entry.value.password }),
          connectOnStartup: entry.value.connectOnStartup,
          ...(entry.value.highVolumeEvents === undefined
            ? {}
            : { highVolumeEvents: entry.value.highVolumeEvents }),
          state: "disconnected",
        });
        return entry.value.state === "connected"
          ? entry.value.client.disconnect
          : Deferred.succeed(entry.value.canceled, undefined).pipe(
              Effect.andThen(Fiber.interrupt(entry.value.connection)),
            );
      }).pipe(stateLock.withPermit);
      yield* close;
    });

    const connect = Effect.fnUntraced(function* (address: SocketAddress) {
      const started = yield* Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
        if (Option.isNone(current)) return yield* new SocketNotFound({ address });
        if (current.value.state === "connected" || current.value.state === "connecting")
          return Option.none<{
            readonly config: SocketConfig;
            readonly connection: Fiber.Fiber<ObsWebSocket.Client, ConnectionFailed>;
            readonly canceled: Deferred.Deferred<void>;
          }>();

        const config: SocketConfig = {
          ...(current.value.name === undefined ? {} : { name: current.value.name }),
          ...(current.value.password === undefined ? {} : { password: current.value.password }),
          connectOnStartup: current.value.connectOnStartup,
          ...(current.value.highVolumeEvents === undefined
            ? {}
            : { highVolumeEvents: current.value.highVolumeEvents }),
        };
        const canceled = yield* Deferred.make<void>();
        const connection = yield* ObsWebSocket.make(address, config.password, {
          ...(config.highVolumeEvents === undefined
            ? {}
            : { highVolumeEvents: config.highVolumeEvents }),
          onOpen: mg.emit(new ObsEvent.ConnectionOpened({ address })),
        }).pipe(
          Effect.provideContext(socketContext),
          Effect.mapError(
            () =>
              new ConnectionFailed({
                reason: "Could not connect to the OBS WebSocket",
              }),
          ),
          Effect.forkScoped,
        );
        yield* setEntry(address, {
          ...config,
          state: "connecting",
          connection,
          canceled,
        });
        return Option.some({ config, connection, canceled });
      }).pipe(stateLock.withPermit);
      if (Option.isNone(started)) return;
      const { config, connection, canceled } = started.value;

      const client = yield* Effect.raceFirst(
        Fiber.join(connection),
        Deferred.await(canceled).pipe(
          Effect.andThen(
            Effect.fail(
              new ConnectionFailed({
                reason: "The OBS WebSocket connection was canceled",
              }),
            ),
          ),
        ),
      ).pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const latest = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
            if (
              Option.isSome(latest) &&
              latest.value.state === "connecting" &&
              latest.value.connection === connection
            )
              yield* setEntry(address, {
                ...config,
                state: "error",
                error: error.reason,
              });
          }).pipe(stateLock.withPermit),
        ),
      );

      const installed = yield* Effect.gen(function* () {
        const latest = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
        if (
          Option.isNone(latest) ||
          latest.value.state !== "connecting" ||
          latest.value.connection !== connection
        )
          return false;
        yield* setEntry(address, { ...config, state: "connected", client });
        return true;
      }).pipe(stateLock.withPermit);
      if (!installed) {
        yield* client.disconnect;
        return yield* new ConnectionFailed({
          reason: "The OBS WebSocket connection was canceled",
        });
      }

      yield* client.events.pipe(
        Stream.runForEach((event) =>
          ObsEvent.decode(event, address).pipe(
            Effect.flatMap(mg.emit),
            Effect.catch(() => Effect.void),
          ),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            const latest = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
            if (
              Option.isSome(latest) &&
              latest.value.state === "connected" &&
              latest.value.client === client
            ) {
              yield* setEntry(address, { ...config, state: "disconnected" });
            }
          }),
        ),
        Effect.forkScoped,
        Effect.provideContext(socketContext),
      );
      yield* Effect.yieldNow;
    });

    if (entries.length !== Object.keys(stored.sockets).length)
      yield* save(yield* SubscriptionRef.get(state));
    yield* Effect.forEach(
      entries,
      ([address, config]) =>
        config.connectOnStartup
          ? connect(address).pipe(
              Effect.catch(() => Effect.void),
              Effect.forkScoped,
              Effect.asVoid,
            )
          : Effect.void,
      { discard: true },
    );

    return {
      resources: OBSSocket.toLayer(
        SubscriptionRef.get(state).pipe(
          Effect.map((sockets) =>
            [...sockets].map(([address, socket]) => ({
              id: address,
              display: socket.name ?? address,
            })),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        Call: Effect.fnUntraced(function* ({ address, requestType, requestData }) {
          const entry = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
          if (Option.isNone(entry) || entry.value.state !== "connected")
            return yield* new SocketNotFound({ address });
          const passwords = [...(yield* SubscriptionRef.get(state))].flatMap(([, socket]) =>
            socket.password === undefined ? [] : [socket.password],
          );

          return yield* entry.value.client.call(requestType, requestData).pipe(
            Effect.mapError((error) =>
              error instanceof ObsWebSocket.RequestError
                ? new RequestFailed({
                    requestType: error.requestType,
                    code: error.code,
                    comment: safeRequestComment(error.comment, passwords),
                  })
                : new ConnectionFailed({
                    reason: "The OBS WebSocket connection was lost",
                  }),
            ),
          );
        }),
      }),
      client: {
        state: SubscriptionRef.get(state).pipe(
          Effect.map((sockets) => ({
            sockets: [...sockets].map(([address, socket]) => ({
              ...(socket.name === undefined ? {} : { name: socket.name }),
              address,
              connectOnStartup: socket.connectOnStartup,
              ...(socket.highVolumeEvents === undefined
                ? {}
                : { highVolumeEvents: socket.highVolumeEvents }),
              state: socket.state,
              ...(socket.state === "error" ? { error: socket.error } : {}),
            })),
          })),
        ),
        rpcs: ClientRpcs.toLayer({
          AddSocket: Effect.fnUntraced(function* ({ address, name, password, highVolumeEvents }) {
            yield* Effect.gen(function* () {
              yield* validateAddress(address);
              yield* disconnect(address);
              const current = yield* SubscriptionRef.get(state);
              yield* save(
                HashMap.set(current, address, {
                  ...(name === undefined ? {} : { name }),
                  ...(password === undefined ? {} : { password }),
                  connectOnStartup: true,
                  ...(highVolumeEvents === undefined ? {} : { highVolumeEvents }),
                  state: "disconnected",
                }),
              );
              yield* mg.resource.refresh(OBSSocket);
            }).pipe(settingsLock.withPermit);
            yield* connect(address).pipe(
              Effect.mapError((error) =>
                error instanceof SocketNotFound
                  ? new ConnectionFailed({
                      reason: "The OBS socket no longer exists",
                    })
                  : error,
              ),
            );
          }),
          UpdateSocket: Effect.fnUntraced(function* ({
            currentAddress,
            address,
            name,
            password,
            connectOnStartup,
            highVolumeEvents,
          }) {
            yield* Effect.gen(function* () {
              yield* validateAddress(address);
              const current = yield* SubscriptionRef.get(state).pipe(
                Effect.map(HashMap.get(currentAddress)),
              );
              if (Option.isNone(current))
                return yield* new SocketNotFound({ address: currentAddress });
              if (address !== currentAddress) yield* disconnect(address);
              yield* disconnect(currentAddress);
              const latest = yield* SubscriptionRef.get(state);
              yield* save(
                HashMap.set(HashMap.remove(latest, currentAddress), address, {
                  ...(name === undefined ? {} : { name }),
                  ...((password ?? current.value.password) === undefined
                    ? {}
                    : { password: password ?? current.value.password }),
                  connectOnStartup,
                  ...((highVolumeEvents ?? current.value.highVolumeEvents) === undefined
                    ? {}
                    : { highVolumeEvents: highVolumeEvents ?? current.value.highVolumeEvents }),
                  state: "disconnected",
                }),
              );
              yield* mg.resource.refresh(OBSSocket);
            }).pipe(settingsLock.withPermit);
            if (connectOnStartup) yield* connect(address);
          }),
          RemoveSocket: Effect.fnUntraced(function* ({ address }) {
            yield* disconnect(address);
            yield* save(HashMap.remove(yield* SubscriptionRef.get(state), address));
            yield* mg.resource.refresh(OBSSocket);
          }, settingsLock.withPermit),
          ConnectSocket: ({ address }) => connect(address),
          DisconnectSocket: ({ address }) => disconnect(address),
        }),
      },
    };
  });
});

export const layer = OBSEngine.toLayer((mg) => make(mg));
export const liveLayer = layer;

export default liveLayer;
