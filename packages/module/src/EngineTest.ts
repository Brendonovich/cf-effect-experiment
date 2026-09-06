import type * as S from "effect/Schema";

import { Effect } from "effect";
import { type Rpc, RpcTest } from "effect/unstable/rpc";

import type * as Engine from "./Engine.ts";
import type { ResourceClass } from "./Resource.ts";

export const makeClients = <
  Resource extends ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
>(
  definition: Engine.Def<Resource, Event, Storage, Rpcs, ClientState, ClientRpcs>,
) =>
  Effect.gen(function* () {
    const engine = yield* definition;
    const client = yield* RpcTest.makeClient(definition.ClientRpcs).pipe(
      Effect.provide(engine.client.rpcs),
    );
    const runtime = yield* RpcTest.makeClient(definition.Rpcs).pipe(Effect.provide(engine.rpcs));

    return { engine, client, runtime };
  });
