import { Cause, Deferred, Effect, Schema, Scope } from "effect";
import { Socket } from "effect/unstable/socket";

import { ConnectionFailed, RequestFailed, type Failure } from "./Definition.ts";

const Packet = Schema.Struct({
  apiName: Schema.Literal("VTubeStudioPublicAPI"),
  apiVersion: Schema.String,
  requestID: Schema.String,
  messageType: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
});
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Packet));
export interface Client {
  readonly call: (
    requestType: string,
    data: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<Readonly<Record<string, unknown>>, Failure>;
  readonly closed: Effect.Effect<void>;
}

export const validateUrl = Effect.fnUntraced(function* (address: string) {
  const failure = new ConnectionFailed({
    reason: "Use a credential-free local WebSocket URL with localhost, 127.0.0.1 or [::1].",
  });
  const url = yield* Effect.try({
    try: () => new URL(address),
    catch: () => failure,
  });
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    address.length > 2048
  )
    return yield* failure;
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
});

export const make = Effect.fnUntraced(function* (
  url: string,
): Effect.fn.Return<Client, Failure, Scope.Scope | Socket.WebSocketConstructor> {
  const address = yield* validateUrl(url);
  const socket = yield* Socket.makeWebSocket(address, { closeCodeIsError: () => true });
  const write = yield* socket.writer;
  const opened = yield* Deferred.make<void, Failure>();
  const closed = yield* Deferred.make<void>();
  const disconnected = Deferred.await(closed).pipe(
    Effect.andThen(Effect.fail(new ConnectionFailed({ reason: "VTube Studio is disconnected." }))),
  );
  const pending = new Map<
    string,
    {
      readonly type: string;
      readonly response: Deferred.Deferred<Readonly<Record<string, unknown>>, Failure>;
    }
  >();
  let sequence = 0;
  let connected = true;
  const fail = Effect.fnUntraced(function* (error: Failure) {
    connected = false;
    yield* Deferred.fail(opened, error);
    yield* Effect.forEach(pending.values(), ({ response }) => Deferred.fail(response, error), {
      discard: true,
    });
    pending.clear();
    yield* Deferred.succeed(closed, undefined);
  });
  yield* Effect.addFinalizer(() =>
    fail(new ConnectionFailed({ reason: "VTube Studio is disconnected." })),
  );
  yield* socket
    .runRaw(
      (input) =>
        decode(typeof input === "string" ? input : new TextDecoder().decode(input)).pipe(
          Effect.mapError(
            () => new ConnectionFailed({ reason: "Invalid VTube Studio protocol message." }),
          ),
          Effect.flatMap((packet) => {
            const request = pending.get(packet.requestID);
            if (!request) return Effect.void;
            if (packet.messageType === "APIError")
              return Deferred.fail(
                request.response,
                new RequestFailed({
                  requestType: request.type,
                  reason: "VTube Studio rejected the request.",
                  ...(typeof packet.data.errorID === "number" ? { code: packet.data.errorID } : {}),
                }),
              ).pipe(Effect.asVoid);
            if (packet.messageType !== `${request.type}Response`)
              return Deferred.fail(
                request.response,
                new RequestFailed({
                  requestType: request.type,
                  reason: "Unexpected response type.",
                }),
              ).pipe(Effect.asVoid);
            return Deferred.succeed(request.response, packet.data).pipe(Effect.asVoid);
          }),
        ),
      { onOpen: Deferred.succeed(opened, undefined).pipe(Effect.asVoid) },
    )
    .pipe(
      Effect.catchCause(() =>
        fail(new ConnectionFailed({ reason: "VTube Studio connection lost." })),
      ),
      Effect.ensuring(fail(new ConnectionFailed({ reason: "VTube Studio is disconnected." }))),
      Effect.forkScoped,
    );
  yield* Deferred.await(opened);
  return {
    closed: Deferred.await(closed),
    call: Effect.fnUntraced(function* (requestType, data) {
      if (!connected)
        return yield* new ConnectionFailed({ reason: "VTube Studio is disconnected." });
      const requestID = `macrograph-${sequence++}`;
      const response = yield* Deferred.make<Readonly<Record<string, unknown>>, Failure>();
      pending.set(requestID, { type: requestType, response });
      return yield* Effect.suspend(() =>
        write(
          JSON.stringify({
            apiName: "VTubeStudioPublicAPI",
            apiVersion: "1.0",
            requestID,
            messageType: `${requestType}Request`,
            data,
          }),
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.fail(new ConnectionFailed({ reason: "Could not send VTube Studio request." })),
        ),
        Effect.andThen(Deferred.await(response)),
        Effect.raceFirst(disconnected),
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () =>
            Effect.fail(
              new RequestFailed({ requestType, reason: "VTube Studio request timed out." }),
            ),
        }),
        Effect.ensuring(Effect.sync(() => pending.delete(requestID))),
      );
    }),
  };
});
