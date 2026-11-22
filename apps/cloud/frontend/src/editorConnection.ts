import type { EditorConnection } from "@macrograph/editor-ui";
import type { ConnectionModules, EditorModules } from "@macrograph/editor-ui/modules";

import { BrowserSocket } from "@effect/platform-browser";
import { DualProtocol, EditorRpc } from "@macrograph/editor";
import {
  createModuleUILoader,
  ModuleCatalogSource,
  ModuleRpcProtocol,
} from "@macrograph/editor-ui/modules";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { Effect, type Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { moduleUIs } from "./moduleUIs";

export interface CloudEditorConnection extends EditorConnection {
  /**
   * The catalog comes from the project editor's `GetModules` (refetched on `ModulesChanged`) and
   * each module's RPCs go over HTTP to `/rpc/projects/<project>/module/<id>/rpc`, which the worker
   * authorizes and forwards into the project's editor.
   */
  readonly modules: ConnectionModules;
}

/** Where a project's module RPC routes live; module ids are appended by the protocol. */
export const moduleRpcBaseUrl = (origin: string, projectId: string) =>
  new URL(`/rpc/projects/${encodeURIComponent(projectId)}/`, origin);

export const makeEditorConnection = (
  wsUrl: string,
  projectId: string,
): Effect.Effect<CloudEditorConnection, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const dualProtocol = yield* DualProtocol.makeDualClientProtocol;
    const withProtocol = Effect.provideService(RpcClient.Protocol, dualProtocol.protocol);
    const client = yield* RpcClient.make(EditorRpc.EditorRpcs).pipe(withProtocol);
    const catalog = yield* RpcClient.make(
      ModuleAdminRpc.ModuleAdminRpcs.middleware(EditorRpc.ConnectionMiddleware),
    ).pipe(withProtocol);
    // The session cookie authenticates same-origin requests, so no bearer token is sent.
    const rpcProtocol = yield* ModuleRpcProtocol.http({
      baseUrl: moduleRpcBaseUrl(window.location.origin, projectId),
      token: () => null,
    }).pipe(Effect.provide(FetchHttpClient.layer));
    return {
      client,
      modules: { catalog: ModuleCatalogSource.fromRpc({ client: catalog }), rpcProtocol },
    };
  }).pipe(Effect.provide([RpcSerialization.layerJsonRpc(), BrowserSocket.layerWebSocket(wsUrl)]));

export const editorModules = (): EditorModules<CloudEditorConnection> => ({
  catalog: (connection) => connection.modules.catalog,
  rpcProtocol: (connection) => connection.modules.rpcProtocol,
  loader: createModuleUILoader({ static: moduleUIs }),
});
