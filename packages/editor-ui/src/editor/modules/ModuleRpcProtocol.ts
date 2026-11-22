import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Option, type Context, type Scope } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

/** How the editor reaches one module's RPCs. */
export type ModuleRpc =
  | { readonly _tag: "Protocol"; readonly protocol: RpcClient.Protocol["Service"] }
  /** Calls the module's handlers in this process, as the playground does. */
  | { readonly _tag: "InProcess"; readonly context: Context.Context<never> };

/** The host app's `moduleRpcProtocol(moduleId)`. Runs in a scope that closes when the module UI is dropped. */
export type ModuleRpcProtocolFactory = (
  moduleId: string,
) => Effect.Effect<ModuleRpc, unknown, Scope.Scope>;

export class ModuleRpcUnavailable extends Error {
  readonly moduleId: string;
  constructor(moduleId: string, reason: string) {
    super(`The RPCs of ${moduleId} are unavailable: ${reason}`);
    this.name = "ModuleRpcUnavailable";
    this.moduleId = moduleId;
  }
}

/** Every module shares one protocol, such as today's editor WebSocket. */
export const shared =
  (protocol: RpcClient.Protocol["Service"]): ModuleRpcProtocolFactory =>
  () =>
    Effect.succeed({ _tag: "Protocol", protocol });

/** In-process handlers keyed by module id. */
export const inProcess =
  (contexts: ReadonlyMap<string, Context.Context<never>>): ModuleRpcProtocolFactory =>
  (moduleId) => {
    const context = contexts.get(moduleId);
    return context === undefined
      ? Effect.fail(new ModuleRpcUnavailable(moduleId, "the module is not running in this editor"))
      : Effect.succeed({ _tag: "InProcess", context });
  };

export const unavailable: ModuleRpcProtocolFactory = (moduleId) =>
  Effect.fail(new ModuleRpcUnavailable(moduleId, "this editor does not connect to module RPCs"));

/** `<base>/module/<namespace>/<publisher>/<name>/rpc` for a full module id. */
export const httpUrl = (baseUrl: string | URL, moduleId: ModuleId.Id) => {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  return new URL(`${ModuleId.routePrefix(moduleId).replace(/^\//, "")}/rpc`, base).href;
};

/**
 * One HTTP RPC client protocol per module, using framed NDJSON so streaming RPCs work. The session
 * token is read on every request, so a token replaced after reconnecting or signing in again is
 * picked up without rebuilding the protocol.
 */
export const http = (options: {
  readonly baseUrl: string | URL;
  readonly token: () => string | null | undefined;
}): Effect.Effect<ModuleRpcProtocolFactory, never, HttpClient.HttpClient> =>
  Effect.map(
    HttpClient.HttpClient,
    (client) => (moduleId) =>
      Option.match(ModuleId.parse(moduleId), {
        onNone: () =>
          Effect.fail(new ModuleRpcUnavailable(moduleId, "the id is not a full module id")),
        onSome: (id) =>
          RpcClient.makeProtocolHttp(
            client.pipe(
              HttpClient.mapRequest(HttpClientRequest.setUrl(httpUrl(options.baseUrl, id))),
              HttpClient.mapRequestEffect((request) =>
                Effect.sync(() => {
                  const token = options.token();
                  return token === null || token === undefined || token === ""
                    ? request
                    : HttpClientRequest.bearerToken(request, token);
                }),
              ),
            ),
          ).pipe(
            Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.ndjson),
            Effect.map((protocol): ModuleRpc => ({ _tag: "Protocol", protocol })),
          ),
      }),
  );

export * as ModuleRpcProtocol from "./ModuleRpcProtocol.ts";
