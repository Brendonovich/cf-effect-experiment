import type { EditorConnection } from "@macrograph/editor-ui";
import type { ClientSettings } from "@macrograph/plugin/ClientSettings";
import type { JSX } from "@solidjs/web";
import type * as S from "effect/Schema";

import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  Packages,
  Presence,
} from "@macrograph/editor";
import { Executor, RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import HttpClientDeployment from "@macrograph/plugin-http-client/Deployment/Local";
import JsonPlugin from "@macrograph/plugin-json";
import ListPlugin from "@macrograph/plugin-list";
import LogicPlugin from "@macrograph/plugin-logic";
import MathPlugin from "@macrograph/plugin-math";
import OBSDeployment from "@macrograph/plugin-obs/Deployment/WebSocket";
import { settings as obsSettings } from "@macrograph/plugin-obs/Settings";
import StringPlugin from "@macrograph/plugin-string";
import TwitchDeployment from "@macrograph/plugin-twitch/Deployment/WebSocket";
import { settings as twitchSettings } from "@macrograph/plugin-twitch/Settings";
import UtilitiesDeployment from "@macrograph/plugin-utilities/Deployment";
import { settings as utilitiesSettings } from "@macrograph/plugin-utilities/Settings";
import WebSocketClientDeployment from "@macrograph/plugin-websocket-client/Deployment/Local";
import { settings as websocketSettings } from "@macrograph/plugin-websocket-client/Settings";
import * as Engine from "@macrograph/plugin/Engine";
import * as Resource from "@macrograph/plugin/Resource";
import { EngineHost } from "@macrograph/project-host/EngineHost";
import { PluginMount } from "@macrograph/project-host/PluginMount";
import { Context, Effect, Layer, Stream, type Scope } from "effect";
import { RpcTest, type Rpc } from "effect/unstable/rpc";

import type { BrowserCredentialProvider } from "./BrowserCredentials";
import type { LocalProjectStore } from "./LocalStoragePersistence";

import { browserServices } from "./BrowserServices";

const engineClient = (editor: Editor.Interface, pluginId: string) =>
  Effect.succeed(
    new Proxy(
      {},
      {
        get:
          (_target, property) =>
          (...args: ReadonlyArray<unknown>) =>
            editor.engine.getRuntimeClient(pluginId).pipe(
              Effect.flatMap((client) => {
                const method = Reflect.get(Object(client), property);
                return typeof method === "function"
                  ? method(...args)
                  : Effect.die(`Engine ${pluginId} has no ${String(property)} RPC`);
              }),
            ),
      },
    ),
  );

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
    credentials === undefined
      ? Engine.emptyCredentialsLayer
      : Layer.succeed(Engine.Credentials)(credentials.service),
  );
  const events = EditorEvents.layer.pipe(Layer.provideMerge(base));
  const editor = Editor.layer.pipe(
    Layer.provideMerge(events),
    Layer.provide(Layer.succeed(Editor.CustomEventsEnabled, true)),
  );
  const rpc = Layer.mergeAll(
    EditorRpc.handlerLayer,
    EditorRpc.connectionMiddlewareLayer,
    RuntimeActivity.handlerLayer,
  ).pipe(Layer.provideMerge(editor), Layer.provide(EditorAccess.permissivePolicy(store.projectId)));

  return Layer.build(rpc).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        const editorService = yield* Editor.Service;
        const persistenceService = yield* Persistence.Service;
        const editorEvents = yield* EditorEvents.Service;
        const activity = yield* RuntimeActivity.Service;
        const scope = yield* Effect.scope;
        const executor = activity.wrap(
          yield* Executor.make(yield* persistenceService.loadProject(), {
            projectId: store.projectId,
            customEvents: {
              scope,
              track: (name, payload, handler) =>
                activity.track("project-events", { _tag: name, payload }, handler),
            },
            executionDriver: activity.executionDriver,
            engineClient: (pluginId) => engineClient(editorService, pluginId),
            resourceValues: ({ package: pluginId, resource }) =>
              editorService.engine.getResourceValues(pluginId, resource).pipe(Effect.orDie),
          }),
        );
        yield* Stream.fromSubscription(yield* editorEvents.subscribe).pipe(
          Stream.runForEach(() =>
            persistenceService
              .loadProject()
              .pipe(Effect.flatMap(executor.loadProject), Effect.orDie),
          ),
          Effect.forkScoped,
        );

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
            yield* executor.plugin(deployment.plugin, deployment);
            const context = EngineHost.editorContextLayer(deployment, {
              emit: (event) =>
                executor
                  .handleEvent(
                    deployment.plugin,
                    event as Engine.EventOf<typeof deployment.definition>,
                  )
                  .pipe(
                    Effect.catchCause((cause) =>
                      Effect.logError(`Local ${deployment.pluginId} event failed`, cause),
                    ),
                  ),
            });
            const engineContext = yield* Layer.build(
              EngineHost.layer(deployment, context).pipe(Layer.provide(browserServices)),
            );
            const instance = Context.get(engineContext, deployment.definition);
            yield* EngineHost.mount(deployment.plugin, deployment, instance.client.state);
            return engineContext;
          });

        const utilitiesContext = yield* mount(UtilitiesDeployment);
        yield* mount(HttpClientDeployment);
        for (const plugin of [JsonPlugin, ListPlugin, LogicPlugin, MathPlugin, StringPlugin])
          yield* PluginMount.register(executor, plugin);
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
          pluginSettings: new Map<string, ClientSettings.Connected<JSX.Element>>([
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
