import type { EditorConnection, ModuleSettingsEntry } from "@macrograph/editor-ui";
import type { ConnectionModules, EditorModules } from "@macrograph/editor-ui/modules";

import { BrowserSocket } from "@effect/platform-browser";
import { DualProtocol, EditorRpc } from "@macrograph/editor";
import {
  createModuleUILoader,
  ModuleCatalogSource,
  ModuleRpcProtocol,
  staticSettings,
} from "@macrograph/editor-ui/modules";
import { RuntimeActivity } from "@macrograph/execution";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { Effect, type Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

/**
 * How the editor finds module UIs and reaches module RPCs.
 *
 * - `bundled`: the catalog is the loaded packages, settings UIs are bundled into this app, and
 *   module RPCs share the editor WebSocket.
 * - `server`: the catalog comes from `GetModules` (refetched on `ModulesChanged`), UIs are imported
 *   from the catalog's module URLs, and each module's RPCs go over HTTP to
 *   `/module/<namespace>/<publisher>/<name>/rpc`.
 */
export type ModuleLoading = "bundled" | "server";

/** Switch to `"server"` once the server serves `GetModules`, module UI URLs and per-module RPCs. */
export const moduleLoading: ModuleLoading = "bundled";

export interface ServerEditorConnection extends EditorConnection {
  readonly modules: ConnectionModules;
}

export interface EditorConnectionOptions {
  readonly moduleLoading: ModuleLoading;
  /** The app's base URL, which module routes are resolved against. */
  readonly baseUrl: URL;
  /** The current session token, read on every module RPC request. */
  readonly token: () => string | null;
}

const connectionModules = (
  dualProtocol: RpcClient.Protocol["Service"],
  options: EditorConnectionOptions,
): Effect.Effect<ConnectionModules, never, Scope.Scope> =>
  options.moduleLoading === "bundled"
    ? Effect.succeed({
        catalog: ModuleCatalogSource.fromPackages,
        rpcProtocol: ModuleRpcProtocol.shared(dualProtocol),
      })
    : Effect.gen(function* () {
        const admin = yield* RpcClient.make(
          ModuleAdminRpc.ModuleAdminRpcs.middleware(EditorRpc.ConnectionMiddleware),
        ).pipe(Effect.provideService(RpcClient.Protocol, dualProtocol));
        const rpcProtocol = yield* ModuleRpcProtocol.http({
          baseUrl: options.baseUrl,
          token: options.token,
        }).pipe(Effect.provide(FetchHttpClient.layer));
        return { catalog: ModuleCatalogSource.fromRpc({ client: admin }), rpcProtocol };
      });

export function editorConnection(
  url: string,
  options: EditorConnectionOptions,
): Effect.Effect<ServerEditorConnection, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const dualProtocol = yield* DualProtocol.makeDualClientProtocol;
    const client = yield* RpcClient.make(EditorRpc.EditorRpcs).pipe(
      Effect.provideService(RpcClient.Protocol, dualProtocol.protocol),
    );
    const runtimeClient = yield* RpcClient.make(
      RuntimeActivity.Rpcs.middleware(EditorRpc.ConnectionMiddleware),
    ).pipe(Effect.provideService(RpcClient.Protocol, dualProtocol.protocol));
    return {
      client,
      modules: yield* connectionModules(dualProtocol.protocol, options),
      activity: runtimeClient.ActivityStream(),
      replayEvent: (eventId: string) => runtimeClient.ReplayEvent({ eventId }),
    };
  }).pipe(Effect.provide([RpcSerialization.layerJsonRpc(), BrowserSocket.layerWebSocket(url)]));
}

/** The editor's module wiring for a connection opened by `editorConnection`. */
export const editorModules = (
  moduleLoading: ModuleLoading,
  bundled: ReadonlyArray<ModuleSettingsEntry>,
): EditorModules<ServerEditorConnection> => ({
  catalog: (connection) => connection.modules.catalog,
  rpcProtocol: (connection) => connection.modules.rpcProtocol,
  loader: createModuleUILoader(
    moduleLoading === "bundled" ? { static: staticSettings(bundled) } : { url: true },
  ),
});
