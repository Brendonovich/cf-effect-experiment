import type { EditorConnection } from "@macrograph/editor-ui";
import type { ClientSettings } from "@macrograph/module/ClientSettings";
import type { JSX } from "@solidjs/web";
import type * as S from "effect/Schema";

import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  Packages,
  Presence,
  QueueRuntime,
} from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { LiveRuntime } from "@macrograph/live-runtime";
import HttpClientDeployment from "@macrograph/module-http-client/Deployment/Local";
import JsonModule from "@macrograph/module-json";
import ListModule from "@macrograph/module-list";
import LogicModule from "@macrograph/module-logic";
import MathModule from "@macrograph/module-math";
import OBSDeployment from "@macrograph/module-obs/Deployment/WebSocket";
import { settings as obsSettings } from "@macrograph/module-obs/Settings";
import StringModule from "@macrograph/module-string";
import TwitchDeployment from "@macrograph/module-twitch/Deployment/WebSocket";
import { settings as twitchSettings } from "@macrograph/module-twitch/Settings";
import UtilitiesDeployment from "@macrograph/module-utilities/Deployment";
import { settings as utilitiesSettings } from "@macrograph/module-utilities/Settings";
import WebSocketClientDeployment from "@macrograph/module-websocket-client/Deployment/Local";
import { settings as websocketSettings } from "@macrograph/module-websocket-client/Settings";
import * as Engine from "@macrograph/module/Engine";
import * as Resource from "@macrograph/module/Resource";
import { EngineHost } from "@macrograph/project-host/EngineHost";
import { ModuleMount } from "@macrograph/project-host/ModuleMount";
import { Context, Effect, Layer, type Scope } from "effect";
import { RpcTest, type Rpc } from "effect/unstable/rpc";

import type { BrowserCredentialProvider } from "./BrowserCredentials";
import type { LocalProjectStore } from "./LocalStoragePersistence";

import { browserServices } from "./BrowserServices";

export const makeLocalConnection = (
  store: LocalProjectStore,
  credentials?: BrowserCredentialProvider,
): Effect.Effect<EditorConnection, unknown, Scope.Scope> => {
  const persistence = store.layer;
  const base = Layer.mergeAll(
    persistence,
    Packages.defaultLayer,
    Presence.layer,
    RuntimeActivity.layer,
    QueueRuntime.layer,
    credentials === undefined
      ? Engine.emptyCredentialsLayer
      : Layer.succeed(Engine.Credentials)(credentials.service),
  );
  const events = EditorEvents.layer.pipe(Layer.provideMerge(base));
  const editor = Editor.layer.pipe(Layer.provideMerge(events));
  const rpc = Layer.mergeAll(
    EditorRpc.handlerLayer,
    EditorRpc.connectionMiddlewareLayer,
    RuntimeActivity.handlerLayer,
  ).pipe(Layer.provideMerge(editor), Layer.provide(EditorAccess.permissivePolicy(store.projectId)));

  return Layer.build(rpc).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        const executor = yield* LiveRuntime.make({ projectId: store.projectId });

        const mount = <
          ResourceType extends Resource.ResourceClass<any, any, any>,
          Event extends { readonly _tag: string },
          Storage extends S.Codec<unknown, unknown, never, never>,
          Rpcs extends Rpc.Any,
          ClientState extends S.Top,
          ClientRpcs extends Rpc.Any,
          EngineError,
          EngineServices,
        >(
          deployment: Engine.Deployment<
            Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
            Layer.Layer<
              Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
              EngineError,
              EngineServices
            >
          >,
        ) =>
          Effect.gen(function* () {
            const context = EngineHost.editorContextLayer(deployment, {
              emit: (event) =>
                executor
                  .handleEvent(
                    deployment.module,
                    event as Engine.EventOf<typeof deployment.definition>,
                  )
                  .pipe(
                    Effect.catchCause((cause) =>
                      Effect.logError(`Local ${deployment.moduleId} event failed`, cause),
                    ),
                  ),
            });
            const engineContext = yield* Layer.build(
              EngineHost.layer(deployment, context).pipe(Layer.provide(browserServices)),
            );
            const instance = Context.get(engineContext, deployment.definition);
            yield* ModuleMount.register(
              executor,
              deployment.module,
              deployment,
              instance.client.state,
            );
            return engineContext;
          });

        const utilitiesContext = yield* mount(UtilitiesDeployment);
        yield* mount(HttpClientDeployment);
        for (const module of [JsonModule, ListModule, LogicModule, MathModule, StringModule])
          yield* ModuleMount.register(executor, module);
        const obsContext = yield* mount(OBSDeployment);
        const twitchContext = yield* mount(TwitchDeployment);
        const websocketContext = yield* mount(WebSocketClientDeployment);
        const [utilitiesConnected, obsConnected, twitchConnected, websocketConnected] =
          yield* Effect.all([
            utilitiesSettings.connectInProcess.pipe(Effect.provide(utilitiesContext)),
            obsSettings.connectInProcess.pipe(Effect.provide(obsContext)),
            twitchSettings.connectInProcess.pipe(Effect.provide(twitchContext)),
            websocketSettings.connectInProcess.pipe(Effect.provide(websocketContext)),
          ] as const);
        const client = yield* RpcTest.makeClient(EditorRpc.EditorRpcs);
        const runtimeClient = yield* RpcTest.makeClient(RuntimeActivity.Rpcs);
        return {
          client,
          activity: runtimeClient.ActivityStream(),
          replayEvent: (eventId: string) => runtimeClient.ReplayEvent({ eventId }),
          moduleSettings: new Map<string, ClientSettings.Connected<JSX.Element>>([
            [utilitiesSettings.id, utilitiesConnected],
            [obsSettings.id, obsConnected],
            [twitchSettings.id, twitchConnected],
            [websocketSettings.id, websocketConnected],
          ]),
        };
      }).pipe(Effect.provide(context)),
    ),
  );
};
