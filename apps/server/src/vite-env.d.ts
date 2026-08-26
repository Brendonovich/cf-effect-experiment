/// <reference types="vite/client" />

declare module "virtual:macrograph-plugin-deployments" {
  import type { Engine } from "@macrograph/plugin";
  import type { Resource } from "@macrograph/plugin";
  import type { Layer, Schema } from "effect";
  import type { Rpc } from "effect/unstable/rpc";

  type ResourceType = Resource.ResourceClass<unknown, string, Schema.Json>;
  type Event = { readonly _tag: string };
  type Storage = Schema.Codec<unknown, unknown, never, never>;
  type Definition = Engine.Def<
    ResourceType,
    Event,
    Storage,
    Rpc.AnyWithProps,
    Schema.Top,
    Rpc.AnyWithProps
  >;
  type Deployment = Engine.Deployment<
    Definition,
    Layer.Layer<
      Engine.Instance<ResourceType, Rpc.AnyWithProps, Schema.Top, Rpc.AnyWithProps>,
      never,
      Engine.EngineContext<ResourceType, Event, Storage>
    >
  >;
  const deployments: ReadonlyArray<Deployment>;
  export default deployments;
}
