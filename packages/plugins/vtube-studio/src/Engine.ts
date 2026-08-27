import { Effect, Exit, Layer, Scope, Semaphore, SubscriptionRef } from "effect";
import { Socket } from "effect/unstable/socket";

import {
  ClientRpcs,
  ClientState,
  ConnectionFailed,
  RequestFailed,
  RuntimeRpcs,
  VTubeStudioEngine,
  VTubeStudioInstance,
} from "./Definition.ts";
import * as Protocol from "./Protocol.ts";

export const layer = Layer.effect(VTubeStudioEngine)(
  Effect.gen(function* () {
    const mg = yield* VTubeStudioEngine.EngineContext;
    let config = yield* mg.storage.get;
    const parentScope = yield* Effect.scope;
    const socketContext = yield* Effect.context<Socket.WebSocketConstructor>();
    const lock = yield* Semaphore.make(1);
    const state = yield* SubscriptionRef.make<typeof ClientState.Type>({
      url: config.url,
      connectOnStartup: config.connectOnStartup,
      state: "disconnected",
    });
    let active: { readonly scope: Scope.Closeable; readonly client: Protocol.Client } | undefined;
    let connectionScope: Scope.Closeable | undefined;
    let generation = 0;
    const publish = (
      status: (typeof ClientState.Type)["state"],
      error?: string,
      expected = generation,
    ) =>
      SubscriptionRef.update(state, (current) =>
        expected === generation
          ? {
              url: config.url,
              connectOnStartup: config.connectOnStartup,
              state: status,
              ...(error === undefined ? {} : { error }),
            }
          : current,
      ).pipe(Effect.andThen(mg.client.refresh));
    const disconnect = Effect.fnUntraced(function* () {
      const expected = ++generation;
      const previous = connectionScope;
      connectionScope = undefined;
      active = undefined;
      if (previous) yield* Scope.close(previous, Exit.void);
      yield* publish("disconnected", undefined, expected);
      return expected;
    });
    const connect = Effect.fnUntraced(function* () {
      const expected = yield* disconnect();
      if (expected !== generation)
        return yield* new ConnectionFailed({ reason: "VTube Studio connection was canceled." });
      yield* Protocol.validateUrl(config.url);
      const scope = yield* Scope.fork(parentScope);
      connectionScope = scope;
      yield* Effect.gen(function* () {
        yield* publish("connecting", undefined, expected);
        if (connectionScope !== scope || expected !== generation)
          return yield* new ConnectionFailed({ reason: "VTube Studio connection was canceled." });
        const client = yield* Protocol.make(config.url).pipe(
          Scope.provide(scope),
          Effect.provideContext(socketContext),
        );
        const identity = { pluginName: "MacroGraph", pluginDeveloper: "MacroGraph Inc." };
        if (!config.authenticationToken) {
          const response = yield* client.call("AuthenticationToken", identity);
          if (
            typeof response.authenticationToken !== "string" ||
            response.authenticationToken === ""
          )
            return yield* new RequestFailed({
              requestType: "AuthenticationToken",
              reason: "VTube Studio did not approve an authentication token.",
            });
          config = { ...config, authenticationToken: response.authenticationToken };
          yield* mg.storage.set(config);
        }
        const authentication = yield* client.call("Authentication", {
          ...identity,
          authenticationToken: config.authenticationToken,
        });
        if (authentication.authenticated !== true)
          return yield* new RequestFailed({
            requestType: "Authentication",
            reason:
              "VTube Studio authentication failed. Reset authentication and approve MacroGraph in VTube Studio.",
          });
        if (connectionScope !== scope || expected !== generation)
          return yield* new ConnectionFailed({ reason: "VTube Studio connection was canceled." });
        const entry = { scope, client };
        active = entry;
        yield* publish("connected", undefined, expected);
        yield* client.closed.pipe(
          Effect.andThen(
            Effect.suspend(() =>
              active === entry ? publish("disconnected", undefined, expected) : Effect.void,
            ),
          ),
          Effect.forkScoped,
          Scope.provide(scope),
        );
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? Scope.close(scope, exit).pipe(
                Effect.andThen(
                  Effect.suspend(() => {
                    if (connectionScope !== scope) return Effect.void;
                    connectionScope = undefined;
                    active = undefined;
                    return publish(
                      "error",
                      "Could not authenticate or connect to VTube Studio.",
                      expected,
                    );
                  }),
                ),
              )
            : Effect.void,
        ),
      );
    }, lock.withPermit);
    if (config.connectOnStartup)
      yield* connect().pipe(
        Effect.catch(() => Effect.void),
        Effect.forkScoped,
      );
    return {
      resources: VTubeStudioInstance.toLayer(
        Effect.sync(() => [{ id: config.url, display: config.url }]),
      ),
      rpcs: RuntimeRpcs.toLayer({
        Call: ({ url, requestType, data }) =>
          Effect.suspend(() =>
            active && url === config.url
              ? active.client.call(requestType, data)
              : Effect.fail(
                  new ConnectionFailed({
                    reason: "The selected VTube Studio instance is disconnected.",
                  }),
                ),
          ),
      }),
      client: {
        state: SubscriptionRef.get(state),
        rpcs: ClientRpcs.toLayer({
          VTubeStudioConfigure: Effect.fnUntraced(function* ({
            url,
            connectOnStartup,
            resetAuthentication,
          }) {
            const address = yield* Protocol.validateUrl(url);
            yield* disconnect();
            config = {
              url: address,
              connectOnStartup,
              ...(!resetAuthentication &&
              address === config.url &&
              config.authenticationToken !== undefined
                ? { authenticationToken: config.authenticationToken }
                : {}),
            };
            yield* mg.storage.set(config);
            yield* publish("disconnected");
            yield* mg.resource.refresh(VTubeStudioInstance);
          }, lock.withPermit),
          VTubeStudioConnect: () => connect(),
          VTubeStudioDisconnect: () => disconnect().pipe(Effect.asVoid),
        }),
      },
    };
  }),
);
export default layer;
