import type * as S from "effect/Schema";

import { Effect, Option, Schema, type Scope } from "effect";
import { RpcClient, RpcClientError, RpcTest, type Rpc, type RpcGroup } from "effect/rpc";

export interface Endpoint {
  readonly id: string;
  readonly url: string;
  readonly schema: { readonly id: string; readonly displayName: string };
  readonly instanceKey: string;
  readonly displayName?: string;
  readonly metadata: unknown;
}

export interface RenderContext {
  readonly endpoints: ReadonlyArray<Endpoint>;
  readonly onChanged: () => Promise<void>;
}

export interface Connected<View> {
  /** Decodes the module's client state, fetched by the host for the module it keys this under. */
  readonly load: (state: Effect.Effect<unknown, unknown>) => Effect.Effect<unknown, unknown>;
  readonly render: (state: () => unknown, context: RenderContext) => View;
}

/** A module's settings UI. The host keys descriptors by module id. */
export interface Descriptor<View, Rpcs extends Rpc.Any = never> {
  readonly initial: unknown;
  readonly connect: (
    protocol: RpcClient.Protocol["Service"],
  ) => Effect.Effect<Connected<View>, never, Scope.Scope>;
  readonly connectInProcess: Effect.Effect<
    Connected<View>,
    never,
    Scope.Scope | Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs> | Rpc.MiddlewareClient<Rpcs>
  >;
}

export const make = <State, Rpcs extends Rpc.Any, View>(options: {
  readonly state: S.Codec<State, unknown, never, never>;
  readonly initial: State;
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>;
  readonly render: (
    state: () => State,
    context: RenderContext & {
      readonly rpc: RpcClient.RpcClient<Rpcs, RpcClientError.RpcClientError>;
    },
  ) => View;
  readonly renderInvalid: () => View;
}): Descriptor<View, Rpcs> => {
  const connected = (
    rpc: RpcClient.RpcClient<Rpcs, RpcClientError.RpcClientError>,
  ): Connected<View> => ({
    load: (state) => state.pipe(Effect.flatMap(Schema.decodeUnknownEffect(options.state))),
    render: (state, context) =>
      options.render(
        () => {
          const decoded = Schema.decodeUnknownOption(options.state)(state());
          return Option.isSome(decoded) ? decoded.value : options.initial;
        },
        {
          get endpoints() {
            return context.endpoints;
          },
          get onChanged() {
            return context.onChanged;
          },
          rpc,
        },
      ),
  });
  return {
    initial: options.initial,
    connect: (protocol) =>
      RpcClient.make(options.rpcs).pipe(
        Effect.provideService(RpcClient.Protocol, protocol),
        Effect.map(connected),
      ),
    connectInProcess: RpcTest.makeClient(options.rpcs).pipe(Effect.map(connected)),
  };
};

export * as ClientSettings from "./ClientSettings.ts";
