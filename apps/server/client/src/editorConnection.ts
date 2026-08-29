import type { EditorConnection, PluginSettingsDescriptor } from "@macrograph/editor-ui";

import { BrowserSocket } from "@effect/platform-browser";
import { DualProtocol, EditorRpc } from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { Effect, type Scope } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

export function editorConnection(
  url: string,
  settingsDescriptors: ReadonlyArray<PluginSettingsDescriptor>,
): Effect.Effect<EditorConnection, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const dualProtocol = yield* DualProtocol.makeDualClientProtocol;
    const client = yield* RpcClient.make(EditorRpc.EditorRpcs).pipe(
      Effect.provideService(RpcClient.Protocol, dualProtocol.protocol),
    );
    const runtimeClient = yield* RpcClient.make(
      RuntimeActivity.Rpcs.middleware(EditorRpc.ConnectionMiddleware),
    ).pipe(Effect.provideService(RpcClient.Protocol, dualProtocol.protocol));
    const settings = yield* Effect.forEach(settingsDescriptors, (registration) =>
      registration
        .connect(dualProtocol.protocol)
        .pipe(Effect.map((connected) => [registration.id, connected] as const)),
    );
    return {
      client,
      pluginSettings: new Map(settings),
      activity: runtimeClient.ActivityStream(),
      replayEvent: (eventId: string) => runtimeClient.ReplayEvent({ eventId }),
    };
  }).pipe(Effect.provide([RpcSerialization.layerJsonRpc(), BrowserSocket.layerWebSocket(url)]));
}
