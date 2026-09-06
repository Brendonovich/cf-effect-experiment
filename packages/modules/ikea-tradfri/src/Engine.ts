import { Cause, Context, Effect, Exit, Layer, Scope, Semaphore } from "effect";
import { DtlsClient, nodeLayer } from "effect-node-dtls";
import { randomBytes } from "node:crypto";

import {
  ClientRpcs,
  IkeaEngine,
  IkeaFailure,
  IkeaLight,
  initialStorage,
  RuntimeRpcs,
  type LightId,
  type LightState,
} from "./Definition.ts";
import * as Native from "./Native.ts";
import {
  command,
  integer,
  parseIds,
  parseLight,
  validateConfig,
  validateSecret,
} from "./Protocol.ts";

export class Transport extends Context.Service<
  Transport,
  {
    readonly connect: (
      options: Native.ConnectionOptions,
    ) => Effect.Effect<Native.Client, IkeaFailure, Scope.Scope>;
  }
>()("IkeaTransport") {}
const sanitize = (error: unknown) =>
  error instanceof IkeaFailure ? error : new IkeaFailure({ reason: "Gateway operation failed." });
const sanitizeCause = Effect.catchCause((cause: Cause.Cause<IkeaFailure>) =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.failCause(cause)
    : Effect.fail(sanitize(Cause.squash(cause))),
);

export const transportLayer = Layer.effect(Transport)(
  Effect.gen(function* () {
    const dtls = yield* DtlsClient;
    const resolver = yield* Native.HostResolver;
    return {
      connect: (options: Native.ConnectionOptions) =>
        Native.connect(options).pipe(
          Effect.provideService(DtlsClient, dtls),
          Effect.provideService(Native.HostResolver, resolver),
        ),
    };
  }),
);

export const runtimeLayer = IkeaEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const transport = yield* Transport;
    const parent = yield* Effect.scope;
    const lock = yield* Semaphore.make(1);
    let active: { scope: Scope.Closeable; client: Native.Client } | undefined;
    const refresh = mg.client.refresh.pipe(Effect.andThen(mg.resource.refresh(IkeaLight)));
    const open = (config: Native.ConnectionOptions) =>
      Effect.suspend(() => transport.connect(config)).pipe(sanitizeCause);
    const disconnect = Effect.fnUntraced(function* () {
      const previous = active;
      active = undefined;
      if (previous) yield* Scope.close(previous.scope, Exit.void);
    }, Effect.uninterruptible);
    // Also wait for a locked RPC that already began closing a child scope.
    yield* Effect.addFinalizer(() => disconnect().pipe(lock.withPermit));
    const establish = Effect.fnUntraced(function* (config: Native.ConnectionOptions) {
      yield* Effect.gen(function* () {
        yield* validateConfig(config);
        yield* validateSecret(config.identity);
        yield* validateSecret(config.psk);
      }).pipe(sanitizeCause);
      yield* disconnect();
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const scope = yield* Scope.fork(parent);
          return yield* restore(
            open(config).pipe(
              Scope.provide(scope),
              Effect.tap((client) =>
                Effect.sync(() => {
                  active = { scope, client };
                }),
              ),
            ),
          ).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void,
            ),
            Effect.ensuring(mg.client.refresh),
          );
        }),
      );
    });
    const getClient = Effect.fnUntraced(function* () {
      const config = yield* mg.storage.get;
      yield* Effect.gen(function* () {
        yield* validateConfig(config);
        yield* validateSecret(config.identity);
        yield* validateSecret(config.psk);
      }).pipe(sanitizeCause);
      if (active?.client.connected) return active.client;
      return yield* establish(config);
    });
    const request = (
      client: Native.Client,
      method: "GET" | "POST" | "PUT",
      path: string,
      body?: unknown,
    ) =>
      Effect.suspend(() => client.request(method, path, body)).pipe(
        sanitizeCause,
        Effect.onExit(() =>
          Effect.suspend(() => (client.connected ? Effect.void : mg.client.refresh)),
        ),
      );
    const selected = Effect.fnUntraced(function* (id: LightId) {
      yield* integer(id, 0, 4294967295, "Light ID");
      const config = yield* mg.storage.get;
      if (!config.lights.some((light) => light.id === id))
        return yield* new IkeaFailure({
          reason: "Light is not in the configured resources; refresh lights in settings.",
        });
      return yield* getClient();
    });
    const listLights = Effect.fnUntraced(
      function* () {
        const client = yield* getClient();
        const raw = yield* request(client, "GET", "15001");
        const ids = yield* parseIds(raw).pipe(sanitizeCause);
        const lights: LightState[] = [];
        for (const id of ids) {
          const raw = yield* request(client, "GET", `15001/${id}`);
          const light = yield* parseLight(id, raw).pipe(sanitizeCause);
          if (light) lights.push(light);
        }
        return lights;
      },
      Effect.timeoutOrElse({
        duration: "60 seconds",
        orElse: () =>
          new IkeaFailure({ reason: "Gateway light enumeration timed out after 60 seconds." }),
      }),
    );
    return IkeaEngine.of({
      resources: IkeaLight.toLayer(
        mg.storage.get.pipe(
          Effect.map(({ lights }) => lights.map(({ id, name }) => ({ id, display: name }))),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        IkeaListLights: () => listLights().pipe(lock.withPermit),
        IkeaGetLightState: Effect.fnUntraced(function* ({ lightId }) {
          const client = yield* selected(lightId);
          const raw = yield* request(client, "GET", `15001/${lightId}`);
          const light = yield* parseLight(lightId, raw).pipe(sanitizeCause);
          if (!light)
            return yield* new IkeaFailure({ reason: "Selected gateway resource is not a light." });
          return light;
        }, lock.withPermit),
        IkeaSetLightState: Effect.fnUntraced(function* ({ lightId, state }) {
          const body = yield* command(state).pipe(sanitizeCause);
          const client = yield* selected(lightId);
          yield* request(client, "PUT", `15001/${lightId}`, body);
        }, lock.withPermit),
      }),
      client: {
        state: mg.storage.get.pipe(
          Effect.map(({ host, timeoutMs, identity, psk, lights }) => ({
            host,
            timeoutMs,
            lights,
            hasCredentials: identity !== "" && psk !== "",
            connected: active?.client.connected ?? false,
          })),
        ),
        rpcs: ClientRpcs.toLayer({
          IkeaPair: Effect.fnUntraced(function* ({ host, timeoutMs, securityCode }) {
            yield* Effect.gen(function* () {
              yield* validateConfig({ host, timeoutMs });
              yield* validateSecret(securityCode);
            }).pipe(sanitizeCause);
            const identity = `macrograph-${randomBytes(12).toString("hex")}`;
            const psk = yield* Effect.scoped(
              Effect.gen(function* () {
                const client = yield* open({
                  host,
                  timeoutMs,
                  identity: "Client_identity",
                  psk: securityCode,
                });
                const raw = yield* request(client, "POST", "15011/9063", { "9090": identity });
                return yield* Effect.gen(function* () {
                  if (
                    typeof raw !== "object" ||
                    raw === null ||
                    !("9091" in raw) ||
                    typeof raw["9091"] !== "string"
                  )
                    return yield* new IkeaFailure({
                      reason: "Gateway returned an invalid pairing response.",
                    });
                  return yield* validateSecret(raw["9091"]);
                }).pipe(sanitizeCause);
              }),
            );
            yield* Effect.gen(function* () {
              yield* establish({ host, timeoutMs, identity, psk });
              yield* mg.storage.set({ host, timeoutMs, identity, psk, lights: [] });
            }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? disconnect() : Effect.void)));
            yield* refresh;
          }, lock.withPermit),
          IkeaConfigure: Effect.fnUntraced(function* ({ host, timeoutMs }) {
            yield* validateConfig({ host, timeoutMs }).pipe(sanitizeCause);
            yield* disconnect();
            yield* mg.storage.update((config) => ({
              ...config,
              host,
              timeoutMs,
              lights: host === config.host ? config.lights : [],
            }));
            yield* refresh;
          }, lock.withPermit),
          IkeaReconnect: () =>
            mg.storage.get.pipe(
              Effect.flatMap(establish),
              Effect.asVoid,
              Effect.andThen(refresh),
              lock.withPermit,
            ),
          IkeaDisconnect: () => disconnect().pipe(Effect.andThen(refresh), lock.withPermit),
          IkeaForget: () =>
            disconnect().pipe(
              Effect.andThen(mg.storage.set(initialStorage)),
              Effect.andThen(refresh),
              lock.withPermit,
            ),
          IkeaRefreshLights: Effect.fnUntraced(function* () {
            const lights = yield* listLights();
            yield* mg.storage.update((config) => ({
              ...config,
              lights: lights.map(({ id, name }) => ({ id, name })),
            }));
            yield* refresh;
            return lights;
          }, lock.withPermit),
        }),
      },
    });
  }),
);
export const layer = runtimeLayer.pipe(
  Layer.provide(transportLayer.pipe(Layer.provide(Layer.merge(nodeLayer, Native.resolverLayer)))),
);
export default layer;
