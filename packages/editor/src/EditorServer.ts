import { Effect, Scope, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcServer } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { makeDualServerProtocol } from "./DualProtocol.ts";
import { EditorRpcs } from "./EditorRpc.ts";
import { ProjectPubSub } from "./ProjectPubSub.ts";

const encoder = new TextEncoder();

export const toDualHttpEffectWebsocket = (
  onCustom?: (customSocket: Socket.Socket) => Effect.Effect<void, never, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const pubsub = yield* ProjectPubSub.Service;
    const { protocol, onSocket, broadcastCustom } = yield* makeDualServerProtocol(onCustom);

    yield* RpcServer.make(EditorRpcs).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
    );

    yield* Stream.fromSubscription(yield* pubsub.subscribe).pipe(
      Stream.runForEach((event) => broadcastCustom(encoder.encode(JSON.stringify(event)))),
      Effect.forkScoped,
    );

    const httpEffect = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const socket = yield* Effect.orDie(request.upgrade);
      yield* onSocket(socket, Object.entries(request.headers));
      return HttpServerResponse.empty();
    });

    return { httpEffect };
  });
