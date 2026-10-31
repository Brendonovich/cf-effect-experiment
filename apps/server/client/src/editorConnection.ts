import type { EditorConnection, ModuleAdminClient } from "@macrograph/editor-ui";
import type { ConnectionModules, EditorModules } from "@macrograph/editor-ui/modules";

import { BrowserSocket } from "@effect/platform-browser";
import { DualProtocol, EditorRpc } from "@macrograph/editor";
import {
  createModuleUILoader,
  ModuleCatalogSource,
  ModuleRpcProtocol,
} from "@macrograph/editor-ui/modules";
import { RuntimeActivity } from "@macrograph/execution";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { Effect, type Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

/** The server's `ModuleAdminRpcs`, over the editor WebSocket. */
/** The server's `ModuleAdminRpcs`, authorized by the editor connection policy. */
export type ModuleAdminConnection = ModuleAdminClient;

const makeModuleAdmin: Effect.Effect<ModuleAdminClient, never, RpcClient.Protocol | Scope.Scope> =
  RpcClient.make(ModuleAdminRpc.ModuleAdminRpcs.middleware(EditorRpc.ConnectionMiddleware));

export interface ServerEditorConnection extends EditorConnection {
  /**
   * The catalog comes from `GetModules` (refetched on `ModulesChanged`), UIs are imported from the
   * catalog's module URLs, and each module's RPCs go over HTTP to
   * `/module/<namespace>/<publisher>/<name>/rpc`.
   */
  readonly modules: ConnectionModules;
  readonly moduleAdmin: ModuleAdminConnection;
}

export interface EditorConnectionOptions {
  /** The app's base URL, which module routes are resolved against. */
  readonly baseUrl: URL;
  /** The current session token, read on every module RPC request. */
  readonly token: () => string | null;
}

export function editorConnection(
  url: string,
  options: EditorConnectionOptions,
): Effect.Effect<ServerEditorConnection, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const dualProtocol = yield* DualProtocol.makeDualClientProtocol;
    const withProtocol = Effect.provideService(RpcClient.Protocol, dualProtocol.protocol);
    const client = yield* RpcClient.make(EditorRpc.EditorRpcs).pipe(withProtocol);
    const runtimeClient = yield* RpcClient.make(
      RuntimeActivity.Rpcs.middleware(EditorRpc.ConnectionMiddleware),
    ).pipe(withProtocol);
    const moduleAdmin = yield* makeModuleAdmin.pipe(withProtocol);
    const rpcProtocol = yield* ModuleRpcProtocol.http({
      baseUrl: options.baseUrl,
      token: options.token,
    }).pipe(Effect.provide(FetchHttpClient.layer));
    return {
      client,
      modules: { catalog: ModuleCatalogSource.fromRpc({ client: moduleAdmin }), rpcProtocol },
      moduleAdmin,
      activity: runtimeClient.ActivityStream(),
      replayEvent: (eventId: string) => runtimeClient.ReplayEvent({ eventId }),
    };
  }).pipe(Effect.provide([RpcSerialization.layerJsonRpc(), BrowserSocket.layerWebSocket(url)]));
}

/** The editor's module wiring for a connection opened by `editorConnection`. */
export const editorModules = (): EditorModules<ServerEditorConnection> => ({
  catalog: (connection) => connection.modules.catalog,
  rpcProtocol: (connection) => connection.modules.rpcProtocol,
  loader: createModuleUILoader({ url: true }),
});
