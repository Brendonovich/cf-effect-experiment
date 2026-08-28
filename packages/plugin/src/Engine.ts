import { Cause, Context, Effect, Layer, Redacted, Schema } from "effect";
import * as S from "effect/Schema";
import * as Scope from "effect/Scope";
import { RpcClient, RpcGroup, type Rpc } from "effect/unstable/rpc";

import type { Live, Requirement } from "./HttpIngress.ts";
import type { Catalog } from "./Credential.ts";
import { unavailable } from "./Credential.ts";
import type { Plugin } from "./Plugin.ts";
import type { ResourceClass, ToHandler } from "./Resource.ts";

export const EngineTypeId: unique symbol = Symbol.for("~macrograph/Plugin/Engine");

export interface AnyDef {
  readonly [EngineTypeId]: typeof EngineTypeId;
  readonly Storage: S.Codec<unknown, unknown, never, never>;
  readonly InitialStorage: unknown;
  readonly Resource: ReadonlyArray<ResourceClass<any, any, any>>;
}

export type EventOf<Definition extends AnyDef> = Definition extends {
  readonly Event: ReadonlyArray<infer Event>;
}
  ? Extract<Event, { readonly _tag: string }>
  : never;

export type RuntimeClientOf<Definition extends AnyDef> = Definition extends {
  readonly Rpcs: RpcGroup.RpcGroup<infer Rpcs>;
}
  ? RpcClient.RpcClient<Rpcs>
  : never;

export type InstanceOf<Definition extends AnyDef> =
  Definition extends Def<
    infer Resource,
    infer _Event,
    infer _Storage,
    infer Rpcs,
    infer ClientState,
    infer ClientRpcs
  >
    ? Instance<Resource, Rpcs, ClientState, ClientRpcs>
    : never;

export type ContextOf<Definition extends AnyDef> =
  Definition extends Def<
    infer Resource,
    infer Event,
    infer Storage,
    infer _Rpcs,
    infer _ClientState,
    infer _ClientRpcs
  >
    ? ToLayerCtx<Resource, Event, Storage>
    : never;

export type ImplementationLayer<Definition extends AnyDef> = Layer.Layer<
  InstanceOf<Definition>,
  any,
  any
>;

export type Def<
  Resource extends ResourceClass<any, any, any> = never,
  Event extends { _tag: string } = never,
  Storage extends S.Codec<unknown, unknown, never, never> = typeof S.Never,
  Rpcs extends Rpc.Any = never,
  ClientState extends S.Top = typeof S.Never,
  ClientRpcs extends Rpc.Any = never,
> = Context.ServiceClass<
  Instance<Resource, Rpcs, ClientState, ClientRpcs>,
  `macrograph/Plugin/Engine/${number}`,
  Service<Resource, Rpcs, ClientState, ClientRpcs>
> & {
  readonly [EngineTypeId]: typeof EngineTypeId;
  readonly Resource: Resource[];
  readonly Event: Event[];
  readonly Storage: Storage;
  readonly InitialStorage: Storage["Type"] | undefined;
  readonly Rpcs: RpcGroup.RpcGroup<Rpcs>;
  readonly ClientState: ClientState;
  readonly ClientRpcs: RpcGroup.RpcGroup<ClientRpcs>;
  readonly EngineContext: Context.Service<
    EngineContext<Resource, Event, Storage>,
    ToLayerCtx<Resource, Event, Storage>
  >;

  toLayer<EX = never, RX = never>(
    effect: (
      ctx: ToLayerCtx<Resource, Event, Storage>,
    ) => Effect.Effect<Service<Resource, Rpcs, ClientState, ClientRpcs>, EX, RX>,
  ): Layer.Layer<
    Instance<Resource, Rpcs, ClientState, ClientRpcs>,
    EX,
    EngineContext<Resource, Event, Storage> | Exclude<RX, Scope.Scope>
  >;
};

export interface EngineContext<
  Resource extends ResourceClass<any, any, any> = never,
  Event extends { _tag: string } = never,
  Storage extends S.Codec<unknown, unknown, never, never> = typeof S.Never,
> extends Context.ServiceClass.Shape<
  `macrograph/Plugin/EngineContext/${number}`,
  ToLayerCtx<Resource, Event, Storage>
> {}

export interface Instance<
  Resource extends ResourceClass<any, any, any> = never,
  Rpcs extends Rpc.Any = never,
  ClientState extends S.Top = typeof S.Never,
  ClientRpcs extends Rpc.Any = never,
> extends Context.ServiceClass.Shape<
  `macrograph/Plugin/Engine/${number}`,
  Service<Resource, Rpcs, ClientState, ClientRpcs>
> {}

export type Service<
  Resource extends ResourceClass<any, any, any> = never,
  Rpcs extends Rpc.Any = never,
  ClientState extends S.Top = typeof S.Never,
  ClientRpcs extends Rpc.Any = never,
> = {
  resources: Layer.Layer<ToHandler<Resource>>;
  rpcs: Layer.Layer<Rpc.ToHandler<Rpcs>>;
  client: {
    state: Effect.Effect<S.Schema.Type<ClientState>>;
    rpcs: Layer.Layer<Rpc.ToHandler<ClientRpcs>>;
  };
};

export type Credential = {
  id: string;
  provider: string;
  displayName?: string | null;
  clientId?: string;
  token: { access: Redacted.Redacted<string> };
};

export interface CredentialService {
  readonly get: Effect.Effect<Array<Credential>>;
  readonly refresh: (provider: string, id: string) => Effect.Effect<Credential>;
  readonly subscribe: (
    callback: () => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly catalog?: Effect.Effect<Catalog>;
  readonly refetch?: Effect.Effect<Catalog>;
  readonly auth?: import("./Credential.ts").AuthController;
}

/** Provides plugin engines with credential access, refresh, and change notifications. */
export class Credentials extends Context.Service<Credentials, CredentialService>()(
  "@macrograph/plugin/Engine/Credentials",
) {}

export const emptyCredentialsLayer = Layer.succeed(Credentials, {
  get: Effect.succeed([]),
  refresh: (provider, id) => Effect.die(`Credential ${provider}/${id} is not configured`),
  subscribe: () => Effect.void,
  catalog: Effect.succeed(unavailable("no-provider", "No credential provider is configured.")),
  refetch: Effect.succeed(unavailable("no-provider", "No credential provider is configured.")),
});

export type ToLayerCtx<
  Resource extends ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
> = {
  storage: {
    get: Effect.Effect<Storage["Type"]>;
    set: (v: Storage["Type"]) => Effect.Effect<void>;
    update: (f: (v: Storage["Type"]) => Storage["Type"]) => Effect.Effect<void>;
  };
  resource: {
    refresh: (resource: Resource) => Effect.Effect<void>;
  };
  credentials: CredentialService;
  client: {
    refresh: Effect.Effect<void>;
  };
  emit: (event: Event) => Effect.Effect<void>;
};

let engineSequence = 0;

export const make = <
  Resource extends ResourceClass<any, any, any> = never,
  Event extends { _tag: string } = never,
  Storage extends S.Codec<unknown, unknown, never, never> = typeof S.Never,
  Rpcs extends Rpc.Any = never,
  ClientState extends S.Top = typeof S.Never,
  ClientRpcs extends Rpc.Any = never,
>(opts: {
  resources?: Resource[];
  events?: Array<Event>;
  // server persisted state
  storage?: Storage;
  initialStorage?: Storage["Type"];
  rpcs?: RpcGroup.RpcGroup<Rpcs>;
  client?: {
    // non-persisted state sent to client
    state: ClientState;
    rpcs: RpcGroup.RpcGroup<ClientRpcs>;
  };
}): Def<Resource, Event, Storage, Rpcs, ClientState, ClientRpcs> => {
  const id = engineSequence++;
  const EngineContextTag = Context.Service<
    EngineContext<Resource, Event, Storage>,
    ToLayerCtx<Resource, Event, Storage>
  >(`macrograph/Plugin/EngineContext/${id}`);
  class Engine extends Context.Service<
    Instance<Resource, Rpcs, ClientState, ClientRpcs>,
    Service<Resource, Rpcs, ClientState, ClientRpcs>
  >()(`macrograph/Plugin/Engine/${id}`) {
    static readonly [EngineTypeId]: typeof EngineTypeId = EngineTypeId;
    static Resource: Resource[] = opts.resources ?? [];
    static Event: Event[] = opts.events ?? [];
    static Storage = (opts.storage ?? S.Never) as Storage;
    static InitialStorage = opts.initialStorage;
    static Rpcs = (opts.rpcs ?? RpcGroup.make()) as RpcGroup.RpcGroup<Rpcs>;
    static ClientState = (opts.client?.state ?? S.Never) as unknown as ClientState;
    static ClientRpcs = (opts.client?.rpcs ??
      RpcGroup.make()) as unknown as RpcGroup.RpcGroup<ClientRpcs>;
    static EngineContext = EngineContextTag;

    static toLayer<EX = never, RX = never>(
      effect: (
        ctx: ToLayerCtx<Resource, Event, Storage>,
      ) => Effect.Effect<Service<Resource, Rpcs, ClientState, ClientRpcs>, EX, RX>,
    ) {
      return Layer.effect(Engine)(Effect.flatMap(EngineContextTag, effect));
    }
  }

  return Engine;
};

export class DeploymentError extends Schema.TaggedError<DeploymentError>()(
  "EngineDeploymentError",
  { pluginId: Schema.String, cause: Schema.Unknown },
) {}

export interface Deployment<Definition extends AnyDef, EngineLayer extends Layer.Any> {
  readonly plugin: Plugin<Definition> & { readonly engine: Definition };
  readonly pluginId: string;
  readonly definition: Definition;
  readonly layer: EngineLayer;
}

export interface HttpIngressDeployment<
  Definition extends AnyDef,
  EngineLayer extends Layer.Any,
  Handlers extends ReadonlyArray<Live<unknown, unknown>>,
  RequirementsError,
> extends Deployment<Definition, EngineLayer> {
  readonly httpIngress: {
    readonly handlers: Handlers;
    readonly requirements: (
      state: Definition["Storage"]["Type"],
    ) => Effect.Effect<ReadonlyArray<Requirement>, RequirementsError>;
    readonly resolveRequirements: (
      state: unknown,
    ) => Effect.Effect<ReadonlyArray<Requirement>, DeploymentError>;
  };
}

export type AnyDeploymentFor<Definition extends AnyDef> = Deployment<
  Definition,
  ImplementationLayer<Definition>
>;

export type AnyHttpIngressDeploymentFor<Definition extends AnyDef> = HttpIngressDeployment<
  Definition,
  ImplementationLayer<Definition>,
  ReadonlyArray<Live<unknown, unknown>>,
  unknown
>;

export interface AnyHttpIngressDeployment {
  readonly pluginId: string;
  readonly definition: AnyDef;
  readonly httpIngress: {
    readonly handlers: ReadonlyArray<Live<unknown, unknown>>;
    readonly resolveRequirements: (
      state: unknown,
    ) => Effect.Effect<ReadonlyArray<Requirement>, DeploymentError>;
  };
}

export const deployment = <
  Definition extends AnyDef,
  EngineLayer extends ImplementationLayer<Definition>,
>(
  plugin: Plugin<Definition> & { readonly engine: Definition },
  layer: EngineLayer,
): Deployment<Definition, EngineLayer> => ({
  plugin,
  pluginId: plugin.id,
  definition: plugin.engine,
  layer,
});

export const withHttpIngress = <
  Definition extends AnyDef,
  EngineLayer extends ImplementationLayer<Definition>,
  const Handlers extends ReadonlyArray<Live<unknown, unknown>>,
  RequirementsError,
>(
  deployment: Deployment<Definition, EngineLayer>,
  options: {
    readonly handlers: Handlers;
    readonly requirements: (
      state: Definition["Storage"]["Type"],
    ) => Effect.Effect<ReadonlyArray<Requirement>, RequirementsError>;
  },
): HttpIngressDeployment<Definition, EngineLayer, Handlers, RequirementsError> => ({
  ...deployment,
  httpIngress: {
    handlers: options.handlers,
    requirements: options.requirements,
    resolveRequirements: (state) =>
      Schema.decodeUnknownEffect(deployment.definition.Storage)(state).pipe(
        Effect.flatMap(options.requirements),
        Effect.catchCause((cause) =>
          Effect.fail(
            new DeploymentError({ pluginId: deployment.pluginId, cause: Cause.squash(cause) }),
          ),
        ),
      ),
  },
});
