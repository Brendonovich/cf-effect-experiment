import type { Effect } from "effect";
import type { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc";

export namespace Engine {
  export interface Def<RPC extends Rpc.Any> {
    readonly rpcs: RpcGroup.RpcGroup<RPC>;
  }

  export const define = <RPC extends Rpc.Any>(engine: Def<RPC>): Def<RPC> => engine;
}

export class DataInputRef {
  constructor(
    readonly id: string,
    readonly name?: string,
  ) {}
}

export class ExecutionInputRef {
  constructor(
    readonly id: string,
    readonly name?: string,
  ) {}
}

export class ExecutionOutputRef {
  constructor(
    readonly id: string,
    readonly name?: string,
  ) {}
}

export interface IOContext {
  readonly data: {
    readonly in: (id: string, options?: { readonly name?: string }) => DataInputRef;
  };
  readonly exec: {
    readonly in: (id: string, options?: { readonly name?: string }) => ExecutionInputRef;
    readonly out: (id: string, options?: { readonly name?: string }) => ExecutionOutputRef;
  };
}

export type RunContext<IO, Engines extends Record<string, Engine.Def<Rpc.Any>>> = {
  readonly io: IO;
  readonly engine: {
    readonly [Key in keyof Engines]: RpcClient.RpcClient<RpcGroup.Rpcs<Engines[Key]["rpcs"]>>;
  };
};

export type PluginContext<Engines extends Record<string, Engine.Def<Rpc.Any>>> = {
  readonly schema: {
    readonly register: <IO>(schema: {
      readonly id: string;
      readonly name?: string;
      readonly io: (context: IOContext) => IO;
      readonly run: (context: RunContext<IO, Engines>) => Effect.Effect<void>;
    }) => Effect.Effect<void>;
  };
};

export type Plugin<Engines extends Record<string, Engine.Def<Rpc.Any>>> = {
  readonly id: string;
  readonly name?: string;
  readonly engines?: Engines;
  readonly effect: (context: PluginContext<Engines>) => Effect.Effect<void>;
};

export const make = <Engines extends Record<string, Engine.Def<Rpc.Any>> = Record<string, never>>(
  plugin: Plugin<Engines>,
) => plugin;

export * as Plugin from "./Plugin.ts";
