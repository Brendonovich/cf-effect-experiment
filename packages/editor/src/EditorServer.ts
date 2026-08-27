import { Effect, Scope, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { type Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { makeDualServerProtocol } from "./DualProtocol.ts";
import { EditorEvents } from "./EditorEvents.ts";
import { publicEvent } from "./EditorRpc.ts";

const encoder = new TextEncoder();

export const toDualHttpEffectWebsocket = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  onCustom?: (customSocket: Socket.Socket) => Effect.Effect<void, never, Scope.Scope>,
  requestHeaders?: (
    request: HttpServerRequest.HttpServerRequest,
  ) => ReadonlyArray<[string, string]>,
) =>
  Effect.gen(function* () {
    const events = yield* EditorEvents.Service;
    const { protocol, onSocket, broadcastCustom } = yield* makeDualServerProtocol(onCustom);

    yield* RpcServer.make(group).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
    );

    yield* Stream.fromSubscription(yield* events.subscribe).pipe(
      Stream.runForEach((event) =>
        broadcastCustom(encoder.encode(JSON.stringify(publicEvent(event)))),
      ),
      Effect.forkScoped,
    );

    const httpEffect = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const socket = yield* Effect.orDie(request.upgrade);
      yield* onSocket(socket, requestHeaders?.(request) ?? Object.entries(request.headers));
      return HttpServerResponse.empty();
    });

    return { httpEffect };
  });

export const mergeRpcGroups = (
  ...groups: ReadonlyArray<{
    readonly requests: ReadonlyMap<string, Rpc.Any>;
  }>
) => {
  const requests = new Map<string, Rpc.AnyWithProps>();
  for (const group of groups) {
    for (const [name, request] of group.requests) {
      if (requests.has(name)) throw new Error(`RPC operation already registered: ${name}`);
      requests.set(name, request as Rpc.AnyWithProps);
    }
  }
  return RpcGroup.make(...requests.values());
};
