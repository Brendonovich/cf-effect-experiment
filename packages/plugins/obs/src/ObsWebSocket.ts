import { Cause, Crypto, Deferred, Effect, Fiber, PubSub, Schema, Scope, Stream } from "effect";
import { Socket } from "effect/unstable/socket";

import {
  canvasRequests,
  highVolumeSubscriptions,
  supportsCanvases,
  type HighVolumeEvent,
} from "./Protocol.ts";

export class ProtocolError extends Schema.TaggedError<ProtocolError>()(
  "ProtocolError",
  {
    reason: Schema.String,
  },
) {}

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
  "AuthenticationError",
  { reason: Schema.String },
) {}

export class RequestError extends Schema.TaggedError<RequestError>()(
  "RequestError",
  {
    requestType: Schema.String,
    code: Schema.Number,
    comment: Schema.optional(Schema.String),
  },
) {}

export class ConnectionError extends Schema.TaggedError<ConnectionError>()(
  "ConnectionError",
  {
    reason: Schema.String,
  },
) {}

const Authentication = Schema.Struct({
  challenge: Schema.String,
  salt: Schema.String,
});

const IncomingPacket = Schema.Union([
  Schema.Struct({
    op: Schema.Literal(0),
    d: Schema.Struct({
      obsWebSocketVersion: Schema.String,
      rpcVersion: Schema.Number,
      authentication: Schema.optional(Authentication),
    }),
  }),
  Schema.Struct({
    op: Schema.Literal(2),
    d: Schema.Struct({ negotiatedRpcVersion: Schema.Number }),
  }),
  Schema.Struct({
    op: Schema.Literal(5),
    d: Schema.Struct({
      eventType: Schema.String,
      eventIntent: Schema.Number,
      eventData: Schema.Unknown,
    }),
  }),
  Schema.Struct({
    op: Schema.Literal(7),
    d: Schema.Struct({
      requestType: Schema.String,
      requestId: Schema.String,
      requestStatus: Schema.Struct({
        result: Schema.Boolean,
        code: Schema.Number,
        comment: Schema.optional(Schema.String),
      }),
      responseData: Schema.optional(Schema.Unknown),
    }),
  }),
]);

const decodePacket = Schema.decodeUnknownEffect(
  Schema.fromJsonString(IncomingPacket),
);
type IncomingPacket = Schema.Schema.Type<typeof IncomingPacket>;

export interface ObsEvent {
  readonly eventType: string;
  readonly eventIntent: number;
  readonly eventData: unknown;
}

export type CallError = RequestError | ConnectionError;
export type ConnectError = ProtocolError | AuthenticationError | ConnectionError;

export interface Client {
  readonly call: (
    requestType: string,
    requestData?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<unknown, CallError>;
  // The engine owns this single-consumer stream, subscribed before socket startup.
  readonly events: Stream.Stream<ObsEvent>;
  readonly disconnect: Effect.Effect<void>;
}

const authenticate = Effect.fnUntraced(function* (
  crypto: Crypto.Crypto,
  password: string,
  authentication: Schema.Schema.Type<typeof Authentication>,
) {
  const digest = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.mapError(
        (cause) =>
          new AuthenticationError({
            reason: cause.message,
          }),
      ),
      Effect.map((bytes) => {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return globalThis.btoa(binary);
      }),
    );

  const secret = yield* digest(password + authentication.salt);
  return yield* digest(secret + authentication.challenge);
});

export const make = Effect.fnUntraced(function* (
  address: string,
  password?: string,
  options?: {
    readonly highVolumeEvents?: ReadonlyArray<HighVolumeEvent>;
    readonly onOpen?: Effect.Effect<void>;
  },
): Effect.fn.Return<
  Client,
  ConnectError,
  Crypto.Crypto | Scope.Scope | Socket.WebSocketConstructor
> {
  const crypto = yield* Crypto.Crypto;
  const socket = yield* Socket.makeWebSocket(address, {
    closeCodeIsError: () => true,
  });
  const write = yield* socket.writer;
  const identified = yield* Deferred.make<void, ConnectError>();
  const eventBus = yield* PubSub.unbounded<ObsEvent>();
  // Never block socket reads (including request responses) on high-volume consumers.
  const highVolumeBus = yield* PubSub.sliding<ObsEvent>(64);
  // Subscribe before starting the reader so events cannot race engine installation.
  const eventSubscription = yield* PubSub.subscribe(eventBus);
  const highVolumeSubscription = yield* PubSub.subscribe(highVolumeBus);
  const highVolumeEvents = new Set(options?.highVolumeEvents ?? []);
  const pending = new Map<
    string,
    {
      readonly requestType: string;
      readonly response: Deferred.Deferred<unknown, CallError>;
    }
  >();
  const requestPrefix = yield* crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) => new ConnectionError({ reason: cause.message })),
  );
  let requestSequence = 0;
  let helloReceived = false;
  let canvasesSupported = false;
  let connected = true;

  const failConnection = (reason: string) =>
    Effect.gen(function* () {
      connected = false;
      const error = new ConnectionError({ reason });
      yield* Deferred.fail(identified, error);
      yield* Effect.forEach(
        pending.values(),
        ({ response }) => Deferred.fail(response, error),
        { discard: true },
      );
      pending.clear();
      yield* PubSub.shutdown(eventBus);
      yield* PubSub.shutdown(highVolumeBus);
    });

  const handlePacket = (
    packet: IncomingPacket,
  ): Effect.Effect<
    void,
    ProtocolError | AuthenticationError | Socket.SocketError
  > => {
    switch (packet.op) {
      case 0:
        if (helloReceived) {
          return Effect.fail(
            new ProtocolError({ reason: "Received Hello more than once" }),
          );
        }
        helloReceived = true;
        canvasesSupported = supportsCanvases(packet.d.obsWebSocketVersion);
        return Effect.gen(function* () {
          if (packet.d.rpcVersion < 1)
            return yield* new ProtocolError({ reason: "OBS does not support RPC version 1" });
          const authentication =
            packet.d.authentication === undefined
              ? undefined
              : password === undefined
                ? yield* new AuthenticationError({
                    reason: "OBS requires a password, but none was provided",
                  })
                : yield* authenticate(
                    crypto,
                    password,
                    packet.d.authentication,
                  );
          yield* write(
            JSON.stringify({
              op: 1,
              d: {
                rpcVersion: 1,
                eventSubscriptions:
                  0x7ff |
                  (canvasesSupported ? 1 << 11 : 0) |
                  [...highVolumeEvents].reduce(
                    (mask, event) => mask | highVolumeSubscriptions[event],
                    0,
                  ),
                ...(authentication === undefined ? {} : { authentication }),
              },
            }),
          );
        });
      case 2:
        return helloReceived && packet.d.negotiatedRpcVersion === 1
          ? Deferred.succeed(identified, undefined).pipe(Effect.asVoid)
          : Effect.fail(new ProtocolError({ reason: "Invalid OBS RPC identification" }));
      case 5:
        if (packet.d.eventType === "ConnectionOpened") return Effect.void;
        if (Object.hasOwn(highVolumeSubscriptions, packet.d.eventType)) {
          if (![...highVolumeEvents].some((event) => event === packet.d.eventType))
            return Effect.void;
          return PubSub.publish(highVolumeBus, packet.d).pipe(Effect.asVoid);
        }
        return PubSub.publish(eventBus, packet.d).pipe(Effect.asVoid);
      case 7: {
        const pendingRequest = pending.get(packet.d.requestId);
        if (pendingRequest === undefined) return Effect.void;
        pending.delete(packet.d.requestId);
        return (
          packet.d.requestStatus.result
            ? Deferred.succeed(pendingRequest.response, packet.d.responseData)
            : Deferred.fail(
                pendingRequest.response,
                new RequestError({
                  requestType: pendingRequest.requestType,
                  code: packet.d.requestStatus.code,
                  comment: packet.d.requestStatus.comment,
                }),
              )
        ).pipe(Effect.asVoid);
      }
    }
  };

  const run = socket
    .runRaw(
      (input) =>
        decodePacket(
          typeof input === "string" ? input : new TextDecoder().decode(input),
        ).pipe(
          Effect.mapError(
            (cause) =>
              new ProtocolError({
                reason: `Invalid OBS WebSocket message: ${cause.message}`,
              }),
          ),
          Effect.flatMap(handlePacket),
        ),
      { onOpen: options?.onOpen },
    )
    .pipe(
      Effect.mapError((error) =>
        error instanceof ProtocolError || error instanceof AuthenticationError
          ? error
          : new ConnectionError({ reason: error.message }),
      ),
      Effect.tapError((error) => Deferred.fail(identified, error)),
      Effect.ensuring(failConnection("OBS WebSocket connection closed")),
    );

  const socketFiber = yield* Effect.forkScoped(run);
  yield* Deferred.await(identified);

  const call: Client["call"] = Effect.fnUntraced(
    function* (requestType, requestData) {
      if (!connected)
        return yield* new ConnectionError({
          reason: "OBS WebSocket is disconnected",
        });

      const canvasUuid = requestData?.canvasUuid;
      if (
        canvasUuid !== undefined &&
        canvasUuid !== "" &&
        (typeof canvasUuid !== "string" || !canvasRequests.has(requestType))
      )
        return yield* new RequestError({
          requestType,
          code: 402,
          comment: "This request does not support the supplied canvasUuid",
        });
      if (
        (requestType === "GetCanvasList" || (typeof canvasUuid === "string" && canvasUuid !== "")) &&
        !canvasesSupported
      )
        return yield* new RequestError({
          requestType,
          code: 204,
          comment: "Canvas requests require obs-websocket 5.7.0 or newer (stable)",
        });
      // Empty canvas pins mean the default canvas, including on older servers.
      const data =
        requestData === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(requestData).filter(
                ([key, value]) => key !== "canvasUuid" || (value !== "" && value !== undefined),
              ),
            );

      const requestId = `${requestPrefix}-${requestSequence++}`;
      const response = yield* Deferred.make<unknown, CallError>();
      pending.set(requestId, { requestType, response });
      const packet = JSON.stringify({
        op: 6,
        d: {
          requestType,
          requestId,
          ...(data === undefined || Object.keys(data).length === 0 ? {} : { requestData: data }),
        },
      });

      return yield* write(packet).pipe(
        Effect.mapError(
          (error) => new ConnectionError({ reason: error.message }),
        ),
        Effect.andThen(Deferred.await(response)),
        Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
      );
    },
  );

  return {
    call,
    events: Stream.merge(
      Stream.fromSubscription(eventSubscription),
      Stream.fromEffectRepeat(
        PubSub.take(highVolumeSubscription).pipe(Effect.onInterrupt(() => Cause.done())),
      ),
    ),
    disconnect: Fiber.interrupt(socketFiber),
  };
});
