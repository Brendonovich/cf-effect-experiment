import type { Project } from "@macrograph/core";
import type { Instances as OpenCodeInstances } from "@macrograph/module-opencode/Instance";
import type * as S from "effect/Schema";

import { Editor } from "@macrograph/editor";
import { Engine, HttpEndpoint, Module, type ModuleId, type Resource } from "@macrograph/module";
import DiscordDefault from "@macrograph/module-discord";
import { DiscordEngine } from "@macrograph/module-discord/Definition";
import { restLayer as discordLayer } from "@macrograph/module-discord/Engine";
import DiscordRestDeployment from "@macrograph/module-discord/RestDeployment";
import ElevenLabsDefault from "@macrograph/module-elevenlabs";
import { ElevenLabsEngine } from "@macrograph/module-elevenlabs/Definition";
import ElevenLabsStandalone from "@macrograph/module-elevenlabs/Deployment";
import { layer as elevenLabsLayer } from "@macrograph/module-elevenlabs/Engine";
import GitHubDefault from "@macrograph/module-github";
import { WebhookDeliveryEvent } from "@macrograph/module-github/Definition";
import GitHubWebhook from "@macrograph/module-github/Deployment/Webhook";
import { unavailableRuntimeClient as unavailableGitHubRuntime } from "@macrograph/module-github/Engine";
import {
  type ModuleCopies,
  ModuleTrust,
  Mounter,
  StaticRegistry,
} from "@macrograph/module-host/core";
import HttpClientDefault from "@macrograph/module-http-client";
import HttpClientStandalone from "@macrograph/module-http-client/Deployment";
import { makeRuntimeClient as makeHttpClientRuntime } from "@macrograph/module-http-client/Engine";
import { secureLayer as secureHttpUrlPolicy } from "@macrograph/module-http-client/UrlPolicy";
import JsonDefault from "@macrograph/module-json";
import KofiDefault from "@macrograph/module-kofi";
import { Payment } from "@macrograph/module-kofi/Definition";
import KofiWebhook from "@macrograph/module-kofi/Deployment/Webhook";
import ListDefault from "@macrograph/module-list";
import LogicDefault from "@macrograph/module-logic";
import MathDefault from "@macrograph/module-math";
import OpenAIDefault from "@macrograph/module-openai";
import { OpenAIEngine } from "@macrograph/module-openai/Definition";
import OpenAIStandalone from "@macrograph/module-openai/Deployment";
import { layer as openAILayer } from "@macrograph/module-openai/Engine";
import OpenCodeDefault from "@macrograph/module-opencode";
import {
  OpenCodeEngine,
  RequestFailure as OpenCodeFailure,
} from "@macrograph/module-opencode/Definition";
import { makeLayer as makeOpenCodeLayer } from "@macrograph/module-opencode/Engine";
import SendblueDefault from "@macrograph/module-sendblue";
import { InboundMessage, SendblueEngine } from "@macrograph/module-sendblue/Definition";
import SendblueWebhook from "@macrograph/module-sendblue/Deployment/Webhook";
import { layer as sendblueLayer } from "@macrograph/module-sendblue/Engine";
import StringDefault from "@macrograph/module-string";
import TwitchDefault from "@macrograph/module-twitch";
import { AccountId, SubscriptionEvent } from "@macrograph/module-twitch/Definition";
import TwitchWebhook from "@macrograph/module-twitch/Deployment/Webhook";
import {
  make as makeTwitchEngine,
  unavailableRuntimeClient as unavailableTwitchRuntime,
} from "@macrograph/module-twitch/Engine";
import { EventSubEndpoint } from "@macrograph/module-twitch/EventSub/Webhook";
import UtilitiesDefault from "@macrograph/module-utilities";
import { TickEvent } from "@macrograph/module-utilities/Definition";
import UtilitiesStandalone from "@macrograph/module-utilities/Deployment";
import { make as makeUtilitiesEngine } from "@macrograph/module-utilities/Engine";
import { Persistence } from "@macrograph/persistence";
import { EngineHost, ExecutorModules } from "@macrograph/project-host";
import { Context, Effect, HashMap, Layer, Option, Schema, type Scope } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { type Rpc, RpcSerialization, RpcServer, RpcTest } from "effect/rpc";

/** The ids the cloud loads its built-in modules under. Every cloud host uses these. */
export const ids = {
  discord: Module.builtinId("discord"),
  elevenlabs: Module.builtinId("elevenlabs"),
  github: Module.builtinId("github"),
  httpClient: Module.builtinId("http-client"),
  json: Module.builtinId("json"),
  kofi: Module.builtinId("kofi"),
  list: Module.builtinId("list"),
  logic: Module.builtinId("logic"),
  math: Module.builtinId("math"),
  openai: Module.builtinId("openai"),
  opencode: Module.builtinId("opencode"),
  sendblue: Module.builtinId("sendblue"),
  string: Module.builtinId("string"),
  twitch: Module.builtinId("twitch"),
  utilities: Module.builtinId("utilities"),
} as const;

export const UtilitiesModule = Module.identify(ids.utilities, UtilitiesDefault);
export const OpenCodeModule = Module.identify(ids.opencode, OpenCodeDefault);

const GitHubDeployment: Engine.Identified<typeof GitHubWebhook> = Engine.identify(
  ids.github,
  GitHubWebhook,
);
const KofiDeployment: Engine.Identified<typeof KofiWebhook> = Engine.identify(
  ids.kofi,
  KofiWebhook,
);
const SendblueDeployment: Engine.Identified<typeof SendblueWebhook> = Engine.identify(
  ids.sendblue,
  SendblueWebhook,
);
const TwitchDeployment: Engine.Identified<typeof TwitchWebhook> = Engine.identify(
  ids.twitch,
  TwitchWebhook,
);

/** Deployments whose webhooks the ingress worker receives. */
export const httpIngressDeployments: readonly [
  typeof TwitchDeployment,
  typeof KofiDeployment,
  typeof GitHubDeployment,
  typeof SendblueDeployment,
] = [TwitchDeployment, KofiDeployment, GitHubDeployment, SendblueDeployment];
/** Deployments the ingress worker polls. */
export const pollingIngressDeployments: readonly [typeof SendblueDeployment] = [SendblueDeployment];

/** What `ProjectEditorDO` offers modules while mounting them into a project's editor. */
export interface EditorHost {
  readonly credentials: Engine.CredentialService;
  readonly endpointHost: Layer.Layer<HttpEndpoint.Host>;
  /** Reconciles the project's HTTP ingress with a module's new storage. */
  readonly reconcile: (
    moduleId: ModuleId.Id,
    state: unknown,
  ) => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
  /** Provisions ingress again for every engine and refreshes the editor's endpoints. */
  readonly reconnectIngress: Effect.Effect<void>;
  readonly openCode: OpenCodeInstances;
}

export type EditorServices =
  | Editor.Service
  | Persistence.Service
  | HttpClient.HttpClient
  | Scope.Scope;

/** What a workflow run gives modules to build their read-only runtime clients. */
export interface WorkflowInput {
  readonly project: Project.Model;
  readonly openCode: OpenCodeInstances;
}

/** One built-in module and everything each cloud host needs to run it. */
export interface CloudModule {
  readonly id: ModuleId.Id;
  /** The registry entry; its metadata matches the package's `macrograph` field. */
  readonly static: ModuleCopies.StaticModule;
  /** Mounts the module into a project's editor, returning its per-module RPC handler. */
  readonly editor: (
    host: EditorHost,
  ) => Effect.Effect<Option.Option<Mounter.RpcHandler>, unknown, EditorServices>;
  /** Registers the module with the workflow executor and decodes its events. */
  readonly executor: ExecutorModules.Entry;
  /** The engine's runtime client in workflow runs, if nodes call it. */
  readonly workflow?: (
    input: WorkflowInput,
  ) => Effect.Effect<unknown, never, HttpClient.HttpClient | Scope.Scope>;
}

type Metadata = Omit<StaticRegistry.BuiltinOptions, "deployment">;

type EditorEngineLayer<
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
> = Layer.Layer<
  Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
  never,
  | Engine.EngineContext<ResourceType, Event, Storage>
  | HttpClient.HttpClient
  | HttpEndpoint.Host
  | Engine.Credentials
>;

/**
 * Hosts an engine in the editor until the scope closes and serves its client RPCs over NDJSON.
 * `reconcile` provisions HTTP ingress whenever the engine saves its storage.
 */
const mountEngine = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
>(
  host: EditorHost,
  deployment: Engine.Identified<
    Engine.Deployment<
      Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
      EditorEngineLayer<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>
    >
  >,
  options: { readonly reconcile?: boolean } = {},
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(Engine.Credentials, host.credentials),
      host.endpointHost,
    );
    const context = EngineHost.editorContextLayer(deployment, {
      emit: () => Effect.void,
      ...(options.reconcile === true
        ? { reconcile: (state: Storage["Type"]) => host.reconcile(deployment.moduleId, state) }
        : {}),
    });
    const built = yield* Layer.build(
      EngineHost.layer(deployment, context).pipe(Layer.provide(services)),
    );
    const instance = Context.get(built, deployment.definition);
    yield* EngineHost.mount(deployment.module, deployment, instance.client.state);
    const handler: Mounter.RpcHandler = yield* RpcServer.toHttpEffect(
      deployment.definition.ClientRpcs,
    ).pipe(
      Effect.provide(built),
      Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.ndjson),
    );
    return Option.some(handler);
  });

const readOnly = Effect.die("Workflow engine context is read-only");
const readOnlyContext = {
  resource: { refresh: () => readOnly },
  credentials: {
    get: Effect.succeed([]),
    refresh: () => Effect.die("Workflow session credentials are unavailable"),
    subscribe: () => readOnly,
  },
  client: { refresh: readOnly },
  emit: () => readOnly,
};

/** Builds an engine with read-only storage from the deployed project and returns its runtime client. */
const workflowEngine =
  <
    ResourceType extends Resource.ResourceClass<any, any, any>,
    Event extends { _tag: string },
    Storage extends S.Codec<unknown, unknown, never, never>,
    Rpcs extends Rpc.Any,
    ClientState extends S.Top,
    ClientRpcs extends Rpc.Any,
  >(
    id: ModuleId.Id,
    definition: Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
    layer: (
      input: WorkflowInput,
    ) => Layer.Layer<
      Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
      never,
      Engine.EngineContext<ResourceType, Event, Storage> | HttpClient.HttpClient
    >,
    storage: (stored: unknown) => Effect.Effect<Storage["Type"]>,
  ) =>
  (input: WorkflowInput) =>
    Effect.gen(function* () {
      // Registration requests every engine client. Decode only when a runtime RPC reads storage.
      const engine = yield* definition.pipe(
        Effect.provide(layer(input)),
        Effect.provide(
          Layer.succeed(definition.EngineContext)(
            definition.EngineContext.of({
              ...readOnlyContext,
              storage: {
                get: storage(input.project.engines[id] ?? definition.InitialStorage),
                set: () => readOnly,
                update: () => readOnly,
              },
            }),
          ),
        ),
      );
      return yield* RpcTest.makeClient(definition.Rpcs).pipe(Effect.provide(engine.rpcs));
    });

const decodeStorage =
  <Storage extends S.Codec<unknown, unknown, never, never>>(storage: Storage, name: string) =>
  (stored: unknown) =>
    Schema.decodeUnknownEffect(storage)(stored).pipe(
      Effect.mapError(() => `Invalid ${name} deployment storage`),
      Effect.orDie,
    );

const stateless = (metadata: Metadata, module: Module.Module<never>): CloudModule => {
  const identified = Module.identify(Module.builtinId(metadata.name), module);
  return {
    id: identified.id,
    static: StaticRegistry.builtin({ ...metadata, deployment: identified }),
    editor: () =>
      Effect.flatMap(Editor.Service, (editor) => editor.module(identified)).pipe(
        Effect.as(Option.none()),
      ),
    executor: ExecutorModules.entry(identified),
  };
};

const unavailableOpenCode: OpenCodeInstances = {
  connectionTypes: ["managed", "remote"],
  resolve: () => Effect.fail(new OpenCodeFailure({ reason: "OpenCode runtime is unavailable" })),
};

const OpenAIDeployment = Engine.identify(ids.openai, OpenAIStandalone);
const ElevenLabsDeployment = Engine.identify(ids.elevenlabs, ElevenLabsStandalone);
// Discord runs only its REST and webhook actions; gateway events need a long-lived connection.
const DiscordDeployment = Engine.identify(ids.discord, DiscordRestDeployment);
const HttpClientDeployment = Engine.identify(ids.httpClient, HttpClientStandalone);
const UtilitiesDeployment = Engine.identify(ids.utilities, UtilitiesStandalone);
// The editor's ticker stays off; deployed projects tick from the ingress worker.
const EditorUtilitiesDeployment = Engine.identify(
  ids.utilities,
  Engine.deployment(UtilitiesModule, makeUtilitiesEngine({ startTicker: false })),
);
const ExecutorOpenCodeDeployment = Engine.identify(
  ids.opencode,
  Engine.deployment(OpenCodeModule, makeOpenCodeLayer(unavailableOpenCode)),
);

/** Twitch in the editor provisions EventSub webhooks through the project's ingress. */
const editorTwitchLayer = (host: EditorHost) =>
  makeTwitchEngine((context) =>
    Effect.gen(function* () {
      const endpointHost = yield* HttpEndpoint.Host;
      const endpointFor = (accountId: AccountId) =>
        endpointHost.get(EventSubEndpoint, accountId).pipe(
          Effect.catch(() =>
            Effect.logWarning("Failed to determine EventSub webhook state", {
              accountId,
            }).pipe(Effect.as(Option.none())),
          ),
        );

      return {
        transport: "webhook" as const,
        state: Effect.gen(function* () {
          let current = HashMap.empty<AccountId, { readonly state: "connected" }>();
          for (const accountId of yield* context.getAccountIds) {
            const endpoint = yield* endpointFor(accountId);
            if (Option.isSome(endpoint)) {
              current = HashMap.set(current, accountId, { state: "connected" });
            }
          }
          return current;
        }),
        connect: Effect.fnUntraced(function* () {
          // Retry provider setup even when saved settings and endpoint IDs are unchanged.
          yield* host.reconnectIngress;
          yield* context.refresh;
        }),
        disconnect: () => context.refresh,
      };
    }),
  ).pipe(Layer.provide(Layer.mergeAll(host.endpointHost, FetchHttpClient.layer)));

/** Every built-in the cloud runs, with the metadata its `package.json` declares. */
export const modules: ReadonlyArray<CloudModule> = [
  {
    id: ids.discord,
    static: StaticRegistry.builtin({
      name: "discord",
      displayName: "Discord",
      description: "Send messages and react to events with a Discord bot.",
      deployment: DiscordDeployment,
    }),
    editor: (host) => mountEngine(host, DiscordDeployment),
    executor: ExecutorModules.entry(
      Module.identify(ids.discord, DiscordDefault),
      Schema.Never,
      DiscordDeployment,
    ),
    workflow: workflowEngine(
      ids.discord,
      DiscordEngine,
      () => discordLayer,
      // The Discord engine reads storage while constructing, so invalid settings must not fail
      // every workflow; its actions then report that Discord is not configured.
      (stored) =>
        Schema.decodeUnknownEffect(DiscordEngine.Storage)(stored).pipe(
          Effect.orElseSucceed(() => ({
            token: "",
            gatewayEnabled: false,
            messageContent: false,
          })),
        ),
    ),
  },
  {
    id: ids.elevenlabs,
    static: StaticRegistry.builtin({
      name: "elevenlabs",
      displayName: "ElevenLabs",
      description: "Generate speech with ElevenLabs text to speech.",
      deployment: ElevenLabsDeployment,
    }),
    editor: (host) => mountEngine(host, ElevenLabsDeployment),
    executor: ExecutorModules.entry(
      Module.identify(ids.elevenlabs, ElevenLabsDefault),
      Schema.Never,
      ElevenLabsDeployment,
    ),
    workflow: workflowEngine(
      ids.elevenlabs,
      ElevenLabsEngine,
      () => elevenLabsLayer,
      decodeStorage(ElevenLabsEngine.Storage, "ElevenLabs"),
    ),
  },
  {
    id: ids.github,
    static: StaticRegistry.builtin({
      name: "github",
      displayName: "GitHub",
      description: "Call the GitHub API and react to repository events.",
      deployment: GitHubDeployment,
    }),
    editor: (host) => mountEngine(host, GitHubDeployment, { reconcile: true }),
    executor: ExecutorModules.entry(
      Module.identify(ids.github, GitHubDefault),
      WebhookDeliveryEvent,
      GitHubDeployment,
    ),
    workflow: () => Effect.succeed(unavailableGitHubRuntime),
  },
  {
    id: ids.httpClient,
    static: StaticRegistry.builtin({
      name: "http-client",
      displayName: "HTTP Client",
      description: "Send HTTP requests and work with URLs.",
      deployment: HttpClientDeployment,
    }),
    editor: (host) => mountEngine(host, HttpClientDeployment),
    executor: ExecutorModules.entry(
      Module.identify(ids.httpClient, HttpClientDefault),
      Schema.Never,
      HttpClientDeployment,
    ),
    workflow: () => makeHttpClientRuntime().pipe(Effect.provide(secureHttpUrlPolicy)),
  },
  stateless(
    {
      name: "json",
      displayName: "JSON",
      description: "Build, inspect, and transform JSON values.",
    },
    JsonDefault,
  ),
  {
    id: ids.kofi,
    static: StaticRegistry.builtin({
      name: "kofi",
      displayName: "Ko-fi",
      description: "React to Ko-fi donations, subscriptions and shop orders.",
      deployment: KofiDeployment,
    }),
    editor: (host) => mountEngine(host, KofiDeployment, { reconcile: true }),
    executor: ExecutorModules.entry(
      Module.identify(ids.kofi, KofiDefault),
      Payment,
      KofiDeployment,
    ),
  },
  stateless(
    {
      name: "list",
      displayName: "List",
      description: "Create, inspect, and transform typed lists.",
    },
    ListDefault,
  ),
  stateless(
    {
      name: "logic",
      displayName: "Logic",
      description: "Branch, compare, and combine values with logical operations.",
    },
    LogicDefault,
  ),
  stateless(
    {
      name: "math",
      displayName: "Math",
      description: "Perform arithmetic, comparisons, rounding, and other numeric operations.",
    },
    MathDefault,
  ),
  {
    id: ids.openai,
    static: StaticRegistry.builtin({
      name: "openai",
      displayName: "OpenAI",
      description: "Generate text and images with OpenAI.",
      deployment: OpenAIDeployment,
    }),
    editor: (host) => mountEngine(host, OpenAIDeployment),
    executor: ExecutorModules.entry(
      Module.identify(ids.openai, OpenAIDefault),
      Schema.Never,
      OpenAIDeployment,
    ),
    workflow: workflowEngine(
      ids.openai,
      OpenAIEngine,
      () => openAILayer,
      decodeStorage(OpenAIEngine.Storage, "OpenAI"),
    ),
  },
  {
    id: ids.opencode,
    static: StaticRegistry.builtin({
      name: "opencode",
      displayName: "OpenCode",
      description: "Generates model-agnostic text through OpenCode.",
      deployment: OpenCodeModule,
    }),
    // The deployment needs the project-scoped OpenCode instances the editor provides.
    editor: (host) =>
      mountEngine(
        host,
        Engine.identify(
          ids.opencode,
          Engine.deployment(OpenCodeModule, makeOpenCodeLayer(host.openCode)),
        ),
      ),
    executor: ExecutorModules.entry(OpenCodeModule, Schema.Never, ExecutorOpenCodeDeployment),
    workflow: workflowEngine(
      ids.opencode,
      OpenCodeEngine,
      (input) => makeOpenCodeLayer(input.openCode),
      decodeStorage(OpenCodeEngine.Storage, "OpenCode"),
    ),
  },
  {
    id: ids.sendblue,
    static: StaticRegistry.builtin({
      name: "sendblue",
      displayName: "Sendblue",
      description: "Send and receive iMessages and SMS with Sendblue.",
      deployment: SendblueDeployment,
    }),
    editor: (host) => mountEngine(host, SendblueDeployment, { reconcile: true }),
    executor: ExecutorModules.entry(
      Module.identify(ids.sendblue, SendblueDefault),
      InboundMessage,
      SendblueDeployment,
    ),
    workflow: workflowEngine(
      ids.sendblue,
      SendblueEngine,
      () => sendblueLayer,
      decodeStorage(SendblueEngine.Storage, "Sendblue"),
    ),
  },
  stateless(
    {
      name: "string",
      displayName: "String",
      description: "Create, compare, format, and transform text.",
    },
    StringDefault,
  ),
  {
    id: ids.twitch,
    static: StaticRegistry.builtin({
      name: "twitch",
      displayName: "Twitch",
      description: "Call the Twitch API and react to channel events.",
      deployment: TwitchDeployment,
    }),
    editor: (host) =>
      mountEngine(
        host,
        { ...TwitchDeployment, layer: editorTwitchLayer(host) },
        { reconcile: true },
      ),
    executor: ExecutorModules.entry(
      Module.identify(ids.twitch, TwitchDefault),
      SubscriptionEvent.Any,
      TwitchDeployment,
    ),
    workflow: () => Effect.succeed(unavailableTwitchRuntime),
  },
  {
    id: ids.utilities,
    static: StaticRegistry.builtin({
      name: "utilities",
      displayName: "Utilities",
      description: "General-purpose control flow, formatting, timing, and debugging tools.",
      deployment: UtilitiesDeployment,
    }),
    editor: (host) => mountEngine(host, EditorUtilitiesDeployment),
    executor: ExecutorModules.entry(UtilitiesModule, TickEvent, UtilitiesDeployment),
  },
];

export const byId: ReadonlyMap<ModuleId.Id, CloudModule> = new Map(
  modules.map((module) => [module.id, module]),
);

/** The registry's static source. */
export const staticModules = modules.map((module) => module.static);

/** Host services the cloud provides to its modules. */
export const hostServices = ["http-client", "crypto", "credentials"] as const;

/** Every module, registered with workflow executors. */
export const executorRegistry = ExecutorModules.make(modules.map((module) => module.executor));

/**
 * Mounts the cloud's modules into a project's editor, in the scope the registry provides. Needs
 * the project's editor and persistence, and the HTTP client engines use.
 */
export const mounterLayer = (host: EditorHost) =>
  Layer.effect(Mounter.Service)(
    Effect.gen(function* () {
      // Only these services: the layer's own scope must not replace the module's scope.
      const services = Context.pick(
        Editor.Service,
        Persistence.Service,
        HttpClient.HttpClient,
      )(yield* Effect.context<Editor.Service | Persistence.Service | HttpClient.HttpClient>());
      return Mounter.Service.of({
        mount: (input) => {
          const module = byId.get(input.id);
          if (module === undefined)
            return Effect.fail(
              new Mounter.MountError({
                id: input.id,
                message: "The cloud doesn't run this module",
              }),
            );
          return module.editor(host).pipe(
            Effect.mapError(
              (error) =>
                new Mounter.MountError({
                  id: input.id,
                  message: error instanceof Error ? error.message : String(error),
                }),
            ),
            Effect.map((rpc) => ({ rpc })),
            Effect.provide(services),
          );
        },
      });
    }),
  );

/** The static module registry of a project's editor. */
export const registryLayer = (host: EditorHost) =>
  StaticRegistry.layer({ modules: staticModules, hostServices }).pipe(
    Layer.provide([mounterLayer(host), ModuleTrust.none]),
  );
