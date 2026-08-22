import { Crypto, HashMap, Option, Scope, Stream, SubscriptionRef } from "effect";
import * as Effect from "effect/Effect";
import { Socket } from "effect/unstable/socket";

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
};

type SocketEntry = SocketConfig &
  (
    | { readonly state: "disconnected" }
    | { readonly state: "connecting" }
    | { readonly state: "connected"; readonly client: ObsWebSocket.Client }
  );

export default OBSEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(HashMap.empty<SocketAddress, SocketEntry>());
    const socketContext = yield* Effect.context<
      Crypto.Crypto | Scope.Scope | Socket.WebSocketConstructor
    >();

    yield* Stream.runForEach(SubscriptionRef.changes(state), () => mg.client.refresh).pipe(
      Effect.forkScoped,
    );

    const save = Effect.gen(function* () {
      const sockets = yield* SubscriptionRef.get(state);
      yield* mg.storage.set({
        sockets: Object.fromEntries(
          [...sockets].map(([address, socket]) => [
            address,
            {
              ...(socket.name === undefined ? {} : { name: socket.name }),
              ...(socket.password === undefined ? {} : { password: socket.password }),
              connectOnStartup: true,
            },
          ]),
        ),
      });
    });

    const setEntry = (address: SocketAddress, entry: SocketEntry) =>
      SubscriptionRef.update(state, HashMap.set(address, entry));

    const disconnect = Effect.fnUntraced(function* (address: SocketAddress) {
      const entry = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
      if (Option.isNone(entry) || entry.value.state !== "connected") return;

      yield* entry.value.client.disconnect;
      yield* setEntry(address, {
        ...(entry.value.name === undefined ? {} : { name: entry.value.name }),
        ...(entry.value.password === undefined ? {} : { password: entry.value.password }),
        state: "disconnected",
      });
    });

    const connect = Effect.fnUntraced(function* (address: SocketAddress) {
      const current = yield* SubscriptionRef.get(state).pipe(Effect.map(HashMap.get(address)));
      if (Option.isNone(current)) return yield* new SocketNotFound({ address });
      if (current.value.state !== "disconnected") return;

      const config: SocketConfig = {
        ...(current.value.name === undefined ? {} : { name: current.value.name }),
        ...(current.value.password === undefined ? {} : { password: current.value.password }),
      };
      yield* setEntry(address, { ...config, state: "connecting" });

      const client = yield* ObsWebSocket.make(address, config.password).pipe(
        Effect.provideContext(socketContext),
        Effect.mapError((cause) => new ConnectionFailed({ cause })),
        Effect.tapError(() => setEntry(address, { ...config, state: "disconnected" })),
      );

      yield* setEntry(address, { ...config, state: "connected", client });

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

    const stored = yield* mg.storage.get;
    yield* Effect.forEach(
      Object.entries(stored.sockets),
      ([address, config]) =>
        setEntry(SocketAddress.make(address), {
          ...(config.name === undefined ? {} : { name: config.name }),
          ...(config.password === undefined ? {} : { password: config.password }),
          state: "disconnected",
        }),
      { discard: true },
    );
    yield* Effect.forEach(
      Object.entries(stored.sockets),
      ([address, config]) =>
        config.connectOnStartup
          ? connect(SocketAddress.make(address)).pipe(Effect.catch(() => Effect.void))
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

          return yield* entry.value.client.call(requestType, requestData).pipe(
            Effect.mapError((error) =>
              error instanceof ObsWebSocket.RequestError
                ? new RequestFailed({
                    requestType: error.requestType,
                    code: error.code,
                    comment: error.comment,
                  })
                : new ConnectionFailed({ cause: error }),
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
              state: socket.state,
            })),
          })),
        ),
        rpcs: ClientRpcs.toLayer({
          AddSocket: Effect.fnUntraced(function* ({ address, name, password }) {
            yield* disconnect(address);
            yield* setEntry(address, {
              ...(name === undefined ? {} : { name }),
              ...(password === undefined ? {} : { password }),
              state: "disconnected",
            });
            yield* save;
            yield* mg.resource.refresh(OBSSocket);
            yield* connect(address).pipe(
              Effect.mapError((error) =>
                error instanceof SocketNotFound ? new ConnectionFailed({ cause: error }) : error,
              ),
            );
          }),
          RemoveSocket: Effect.fnUntraced(function* ({ address }) {
            yield* disconnect(address);
            yield* SubscriptionRef.update(state, HashMap.remove(address));
            yield* save;
            yield* mg.resource.refresh(OBSSocket);
          }),
          ConnectSocket: ({ address }) => connect(address),
          DisconnectSocket: ({ address }) => disconnect(address),
        }),
      },
    };
  }),
);
