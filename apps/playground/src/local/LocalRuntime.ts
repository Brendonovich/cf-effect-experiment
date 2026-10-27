import type { EditorConnection } from "@macrograph/editor-ui";
import type { ModuleRpcProtocolFactory } from "@macrograph/editor-ui/modules";
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
import { ModuleRpcProtocol } from "@macrograph/editor-ui/modules";
import { RuntimeActivity } from "@macrograph/execution";
import { LiveRuntime } from "@macrograph/live-runtime";
import HttpClientLocalDeployment from "@macrograph/module-http-client/Deployment/Local";
import JsonModule from "@macrograph/module-json";
import ListModule from "@macrograph/module-list";
import LogicModule from "@macrograph/module-logic";
import MathModule from "@macrograph/module-math";
import OBSWebSocketDeployment from "@macrograph/module-obs/Deployment/WebSocket";
import StringModule from "@macrograph/module-string";
import TwitchWebSocketDeployment from "@macrograph/module-twitch/Deployment/WebSocket";
import UtilitiesStandaloneDeployment from "@macrograph/module-utilities/Deployment";
import WebSocketClientLocalDeployment from "@macrograph/module-websocket-client/Deployment/Local";
import * as Engine from "@macrograph/module/Engine";
import * as Module from "@macrograph/module/Module";
import * as Resource from "@macrograph/module/Resource";
import { EngineHost } from "@macrograph/project-host/EngineHost";
import { ModuleMount } from "@macrograph/project-host/ModuleMount";
import { Context, Effect, Layer, type Scope } from "effect";
import { RpcTest, type Rpc } from "effect/rpc";

import type { BrowserCredentialProvider } from "./BrowserCredentials";
import type { LocalProjectStore } from "./LocalStoragePersistence";

import { browserServices } from "./BrowserServices";

export interface LocalEditorConnection extends EditorConnection {
  /** Module settings call the engines mounted in this page directly. */
  readonly moduleRpcProtocol: ModuleRpcProtocolFactory;
}

// Built-ins load under official ids; the settings discovery derives the same ids from package names.
const UtilitiesDeployment = Engine.identify(
  Module.builtinId("utilities"),
  UtilitiesStandaloneDeployment,
);
const HttpClientDeployment = Engine.identify(
  Module.builtinId("http-client"),
  HttpClientLocalDeployment,
);
const OBSDeployment = Engine.identify(Module.builtinId("obs"), OBSWebSocketDeployment);
const TwitchDeployment = Engine.identify(Module.builtinId("twitch"), TwitchWebSocketDeployment);
const WebSocketClientDeployment = Engine.identify(
  Module.builtinId("websocket-client"),
  WebSocketClientLocalDeployment,
);
const statelessModules = [
  Module.identify(Module.builtinId("json"), JsonModule),
  Module.identify(Module.builtinId("list"), ListModule),
  Module.identify(Module.builtinId("logic"), LogicModule),
  Module.identify(Module.builtinId("math"), MathModule),
  Module.identify(Module.builtinId("string"), StringModule),
];

export const makeLocalConnection = (
  store: LocalProjectStore,
  credentials?: BrowserCredentialProvider,
): Effect.Effect<LocalEditorConnection, unknown, Scope.Scope> => {
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
          deployment: Engine.Identified<
            Engine.Deployment<
              Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
              Layer.Layer<
                Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
                EngineError,
                EngineServices
              >
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
        for (const module of statelessModules) yield* ModuleMount.register(executor, module);
        const obsContext = yield* mount(OBSDeployment);
        const twitchContext = yield* mount(TwitchDeployment);
        const websocketContext = yield* mount(WebSocketClientDeployment);
        const client = yield* RpcTest.makeClient(EditorRpc.EditorRpcs);
        const runtimeClient = yield* RpcTest.makeClient(RuntimeActivity.Rpcs);
        return {
          client,
          activity: runtimeClient.ActivityStream(),
          replayEvent: (eventId: string) => runtimeClient.ReplayEvent({ eventId }),
          moduleRpcProtocol: ModuleRpcProtocol.inProcess(
            new Map<string, Context.Context<never>>([
              [UtilitiesDeployment.moduleId, utilitiesContext],
              [OBSDeployment.moduleId, obsContext],
              [TwitchDeployment.moduleId, twitchContext],
              [WebSocketClientDeployment.moduleId, websocketContext],
            ]),
          ),
        };
      }).pipe(Effect.provide(context)),
    ),
  );
};
