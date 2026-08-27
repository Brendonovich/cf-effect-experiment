import { Effect, Exit, Layer, Schema, Scope, Semaphore, SubscriptionRef } from "effect";
import { Socket } from "effect/unstable/socket";

import {
  ClientRpcs,
  ClientState,
  ConnectionFailed,
  RequestFailed,
  RuntimeRpcs,
  Voices,
  VoicemodEngine,
} from "./Definition.ts";
import * as Protocol from "./Protocol.ts";

const Registration = Schema.Struct({ status: Schema.Struct({ code: Schema.Number }) });

export const layer = Layer.effect(VoicemodEngine)(
  Effect.gen(function* () {
    const mg = yield* VoicemodEngine.EngineContext;
    let config = yield* mg.storage.get;
    const parentScope = yield* Effect.scope;
    const socketContext = yield* Effect.context<Socket.WebSocketConstructor>();
    const lock = yield* Semaphore.make(1);
    const state = yield* SubscriptionRef.make<typeof ClientState.Type>({
      url: config.url,
      hasClientKey: config.clientKey !== "",
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
              hasClientKey: config.clientKey !== "",
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
        return yield* new ConnectionFailed({ reason: "Voicemod connection was canceled." });
      yield* Protocol.validateUrl(config.url);
      if (config.clientKey.trim() === "")
        return yield* new ConnectionFailed({
          reason: "Configure your Voicemod client registration key first.",
        });
      const scope = yield* Scope.fork(parentScope);
      connectionScope = scope;
      yield* Effect.gen(function* () {
        yield* publish("connecting", undefined, expected);
        if (connectionScope !== scope || expected !== generation)
          return yield* new ConnectionFailed({ reason: "Voicemod connection was canceled." });
        const client = yield* Protocol.make(config.url).pipe(
          Scope.provide(scope),
          Effect.provideContext(socketContext),
        );
        const response = yield* client.call("registerClient", { clientKey: config.clientKey });
        const registration = yield* Schema.decodeUnknownEffect(Registration)(response).pipe(
          Effect.mapError(
            () =>
              new RequestFailed({
                action: "registerClient",
                reason: "Invalid Voicemod registration response.",
              }),
          ),
        );
        if (registration.status.code !== 200)
          return yield* new RequestFailed({
            action: "registerClient",
            reason: "Voicemod rejected the client registration key.",
          });
        if (connectionScope !== scope || expected !== generation)
          return yield* new ConnectionFailed({ reason: "Voicemod connection was canceled." });
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
                    return publish("error", "Could not register or connect to Voicemod.", expected);
                  }),
                ),
              )
            : Effect.void,
        ),
      );
    }, lock.withPermit);
    const getClient = Effect.suspend(() =>
      active
        ? Effect.succeed(active.client)
        : Effect.fail(new ConnectionFailed({ reason: "Voicemod is disconnected." })),
    );
    const getVoices = Effect.fnUntraced(function* (client: Protocol.Client) {
      const response = yield* client.call("getVoices", {});
      const { voices } = yield* Schema.decodeUnknownEffect(Schema.Struct({ voices: Voices }))(
        response,
      ).pipe(
        Effect.mapError(
          () =>
            new RequestFailed({
              action: "getVoices",
              reason: "Voicemod returned an invalid voice list.",
            }),
        ),
      );
      return voices;
    });
    const setState = Effect.fnUntraced(function* (query: string, toggle: string, desired: boolean) {
      const client = yield* getClient;
      const read = () =>
        client.call(query, {}).pipe(
          Effect.flatMap((response) =>
            typeof response.value === "boolean"
              ? Effect.succeed(response.value)
              : Effect.fail(
                  new RequestFailed({
                    action: query,
                    reason: "Voicemod returned an invalid state.",
                  }),
                ),
          ),
        );
      if ((yield* read()) === desired) return;
      // Consume the command notification before issuing a query with the same response type.
      yield* client.call(toggle, {});
      if ((yield* read()) !== desired)
        return yield* new RequestFailed({
          action: toggle,
          reason: "Voicemod did not apply the requested state.",
        });
    }, lock.withPermit);
    if (config.connectOnStartup)
      yield* connect().pipe(
        Effect.catch(() => Effect.void),
        Effect.forkScoped,
      );
    return {
      resources: Layer.empty,
      rpcs: RuntimeRpcs.toLayer({
        GetVoices: () => getClient.pipe(Effect.flatMap(getVoices), lock.withPermit),
        SetVoice: Effect.fnUntraced(function* ({ voice }) {
          const client = yield* getClient;
          const voices = yield* getVoices(client);
          const selected =
            voices.find((item) => item.id === voice) ??
            voices.find((item) => item.friendlyName === voice);
          if (!selected || selected.enabled === false)
            return yield* new RequestFailed({
              action: "loadVoice",
              reason: "The requested voice is unavailable.",
            });
          yield* client.send("loadVoice", { voiceID: selected.id });
          const current = yield* client.call("getCurrentVoice", {});
          if (current.voiceID !== selected.id)
            return yield* new RequestFailed({
              action: "loadVoice",
              reason: "Voicemod did not apply the requested voice.",
            });
        }, lock.withPermit),
        SetVoiceChangerState: ({ state }) =>
          setState("getVoiceChangerStatus", "toggleVoiceChanger", state),
        SetHearSelfState: ({ state }) =>
          setState("getHearMyselfStatus", "toggleHearMyVoice", state),
      }),
      client: {
        state: SubscriptionRef.get(state),
        rpcs: ClientRpcs.toLayer({
          VoicemodConfigure: Effect.fnUntraced(function* ({ url, clientKey, connectOnStartup }) {
            const address = yield* Protocol.validateUrl(url);
            yield* disconnect();
            config = { url: address, clientKey: clientKey ?? config.clientKey, connectOnStartup };
            yield* mg.storage.set(config);
            yield* publish("disconnected");
          }, lock.withPermit),
          VoicemodConnect: () => connect(),
          VoicemodDisconnect: () => disconnect().pipe(Effect.asVoid),
        }),
      },
    };
  }),
);
export default layer;
