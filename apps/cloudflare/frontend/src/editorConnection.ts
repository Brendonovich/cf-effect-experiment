import type { EditorConnection, PluginSettingsDescriptor } from "@macrograph/editor-ui";

import { BrowserSocket } from "@effect/platform-browser";
import { DualProtocol, EditorRpc } from "@macrograph/editor";
import { Effect, type Scope } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

export const makeEditorConnection = (
  wsUrl: string,
  settingsDescriptors: ReadonlyArray<PluginSettingsDescriptor>,
): Effect.Effect<EditorConnection, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const dualProtocol = yield* DualProtocol.makeDualClientProtocol;
    const { client, settings } = yield* Effect.all(
      {
        client: RpcClient.make(EditorRpc.EditorRpcs).pipe(
          Effect.provideService(RpcClient.Protocol, dualProtocol.protocol),
        ),
        settings: Effect.forEach(
          settingsDescriptors,
          (registration) =>
            registration
              .connect(dualProtocol.protocol)
              .pipe(Effect.map((connected) => [registration.id, connected] as const)),
          { concurrency: "unbounded" },
        ),
      },
      { concurrency: "unbounded" },
    );
    return { client, pluginSettings: new Map(settings) };
  }).pipe(Effect.provide([RpcSerialization.layerJsonRpc(), BrowserSocket.layerWebSocket(wsUrl)]));
