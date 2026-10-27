import type { EditorConnection, ModuleSettingsEntry } from "@macrograph/editor-ui";
import type { EditorModules } from "@macrograph/editor-ui/modules";

import { BrowserSocket } from "@effect/platform-browser";
import { DualProtocol, EditorRpc } from "@macrograph/editor";
import {
  bundledModules,
  createModuleUILoader,
  ModuleRpcProtocol,
  staticSettings,
  type ModuleRpcProtocolFactory,
} from "@macrograph/editor-ui/modules";
import { Effect, type Scope } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";

export interface CloudEditorConnection extends EditorConnection {
  /** Module RPCs share the project's editor WebSocket until the cloud serves per-module HTTP RPCs. */
  readonly moduleRpcProtocol: ModuleRpcProtocolFactory;
}

export const makeEditorConnection = (
  wsUrl: string,
): Effect.Effect<CloudEditorConnection, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const dualProtocol = yield* DualProtocol.makeDualClientProtocol;
    const client = yield* RpcClient.make(EditorRpc.EditorRpcs).pipe(
      Effect.provideService(RpcClient.Protocol, dualProtocol.protocol),
    );
    return { client, moduleRpcProtocol: ModuleRpcProtocol.shared(dualProtocol.protocol) };
  }).pipe(Effect.provide([RpcSerialization.layerJsonRpc(), BrowserSocket.layerWebSocket(wsUrl)]));

export const editorModules = (
  bundled: ReadonlyArray<ModuleSettingsEntry>,
): EditorModules<CloudEditorConnection> =>
  bundledModules({
    loader: createModuleUILoader({ static: staticSettings(bundled) }),
    rpcProtocol: (connection) => connection.moduleRpcProtocol,
  });
