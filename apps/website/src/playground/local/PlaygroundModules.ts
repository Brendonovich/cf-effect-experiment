import type { Editor } from "@macrograph/editor";
import type { Executor } from "@macrograph/execution";
import type { ModuleCopies } from "@macrograph/module-host/core";
import type { ModuleId } from "@macrograph/module/ModuleId";
import type { Persistence } from "@macrograph/persistence";
import type * as S from "effect/Schema";

import { StaticRegistry } from "@macrograph/module-host/core";
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
import { Context, Effect, Layer, Option, type Scope } from "effect";
import { type Rpc } from "effect/rpc";

import { browserServices } from "./BrowserServices";

type Metadata = Omit<StaticRegistry.BuiltinOptions, "deployment">;

/** How the playground mounts one bundled module, in the scope the registry provides. */
export interface PlaygroundModule {
  readonly static: ModuleCopies.StaticModule;
  /**
   * Registers the module with the editor and executor. Returns the engine's context, whose
   * handlers serve the module's RPCs in-process, if it has an engine.
   */
  readonly mount: (
    id: ModuleId.Id,
    executor: Executor.Service,
  ) => Effect.Effect<Option.Option<Context.Context<never>>, unknown, MountServices>;
}

/** What mounting needs from the local editor runtime. */
export type MountServices = Editor.Service | Persistence.Service | Engine.Credentials | Scope.Scope;

type BrowserServices = Layer.Success<typeof browserServices>;

const mountDeployment = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { readonly _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
  EngineError,
  EngineServices extends
    | BrowserServices
    | Engine.EngineContext<ResourceType, Event, Storage>
    | MountServices,
>(
  executor: Executor.Service,
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
          .handleEvent(deployment.module, event as Engine.EventOf<typeof deployment.definition>)
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
    yield* ModuleMount.register(executor, deployment.module, deployment, instance.client.state);
    return engineContext;
  });

const engine = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { readonly _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
  EngineError,
  EngineServices extends
    | BrowserServices
    | Engine.EngineContext<ResourceType, Event, Storage>
    | MountServices,
>(
  metadata: Metadata,
  deployment: Engine.Deployment<
    Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
    Layer.Layer<
      Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
      EngineError,
      EngineServices
    >
  >,
): PlaygroundModule => ({
  static: StaticRegistry.builtin({ ...metadata, deployment }),
  mount: (id, executor) =>
    Effect.map(mountDeployment(executor, Engine.identify(id, deployment)), (context) =>
      Option.some(context),
    ),
});

const stateless = (metadata: Metadata, module: Module.Module<never>): PlaygroundModule => ({
  static: StaticRegistry.builtin({ ...metadata, deployment: module }),
  mount: (id, executor) =>
    ModuleMount.register(executor, Module.identify(id, module)).pipe(Effect.as(Option.none())),
});

/** Every module the playground bundles, with the metadata its `package.json` declares. */
export const modules: ReadonlyArray<PlaygroundModule> = [
  engine(
    {
      name: "utilities",
      displayName: "Utilities",
      description: "General-purpose control flow, formatting, timing, and debugging tools.",
    },
    UtilitiesStandaloneDeployment,
  ),
  engine(
    {
      name: "http-client",
      displayName: "HTTP Client",
      description: "Send HTTP requests and work with URLs.",
      requires: ["http-client"],
    },
    HttpClientLocalDeployment,
  ),
  stateless(
    {
      name: "json",
      displayName: "JSON",
      description: "Build, inspect, and transform JSON values.",
    },
    JsonModule,
  ),
  stateless(
    {
      name: "list",
      displayName: "List",
      description: "Create, inspect, and transform typed lists.",
    },
    ListModule,
  ),
  stateless(
    {
      name: "logic",
      displayName: "Logic",
      description: "Branch, compare, and combine values with logical operations.",
    },
    LogicModule,
  ),
  stateless(
    {
      name: "math",
      displayName: "Math",
      description: "Perform arithmetic, comparisons, rounding, and other numeric operations.",
    },
    MathModule,
  ),
  stateless(
    {
      name: "string",
      displayName: "String",
      description: "Create, compare, format, and transform text.",
    },
    StringModule,
  ),
  engine(
    {
      name: "obs",
      displayName: "OBS Studio",
      description: "Control OBS Studio and react to its events over obs-websocket.",
      requires: ["crypto", "socket"],
    },
    OBSWebSocketDeployment,
  ),
  engine(
    {
      name: "twitch",
      displayName: "Twitch",
      description: "Call the Twitch API and react to channel events.",
      requires: ["http-client", "socket"],
    },
    TwitchWebSocketDeployment,
  ),
  engine(
    {
      name: "websocket-client",
      displayName: "WebSocket Client",
      description: "Connect to WebSocket servers and exchange messages.",
      requires: ["socket"],
    },
    WebSocketClientLocalDeployment,
  ),
];

/** Host services the browser provides to bundled modules. */
export const hostServices = ["http-client", "socket", "crypto", "credentials"] as const;
