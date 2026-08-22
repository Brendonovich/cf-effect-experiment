import { Crypto, Deferred, Effect, Fiber, PubSub, Schema, Scope, Stream } from "effect";
import { Socket } from "effect/unstable/socket";

export class ProtocolError extends Schema.TaggedErrorClass<ProtocolError>()("ProtocolError", {
  reason: Schema.String,
}) {}

export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()(
  "AuthenticationError",
  { reason: Schema.String },
) {}

export class RequestError extends Schema.TaggedErrorClass<RequestError>()("RequestError", {
  requestType: Schema.String,
  code: Schema.Number,
  comment: Schema.optional(Schema.String),
}) {}

export class ConnectionError extends Schema.TaggedErrorClass<ConnectionError>()("ConnectionError", {
  reason: Schema.String,
}) {}

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

const decodePacket = Schema.decodeUnknownEffect(Schema.fromJsonString(IncomingPacket));
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
): Effect.fn.Return<
  Client,
  ConnectError,
  Crypto.Crypto | Scope.Scope | Socket.WebSocketConstructor
> {
  const crypto = yield* Crypto.Crypto;
  const socket = yield* Socket.makeWebSocket(address, { closeCodeIsError: () => true });
  const write = yield* socket.writer;
  const identified = yield* Deferred.make<void, ConnectError>();
  const eventBus = yield* PubSub.unbounded<ObsEvent>();
  const pending = new Map<string, Deferred.Deferred<unknown, CallError>>();
  const requestPrefix = yield* crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) => new ConnectionError({ reason: cause.message })),
  );
  let requestSequence = 0;
  let helloReceived = false;
  let connected = true;

  const failConnection = (reason: string) =>
    Effect.gen(function* () {
      connected = false;
      const error = new ConnectionError({ reason });
      yield* Deferred.fail(identified, error);
      yield* Effect.forEach(pending.values(), (deferred) => Deferred.fail(deferred, error), {
        discard: true,
      });
      pending.clear();
      yield* PubSub.shutdown(eventBus);
    });

  const handlePacket = (
    packet: IncomingPacket,
  ): Effect.Effect<void, ProtocolError | AuthenticationError | Socket.SocketError> => {
    switch (packet.op) {
      case 0:
        if (helloReceived) {
          return Effect.fail(new ProtocolError({ reason: "Received Hello more than once" }));
        }
        helloReceived = true;
        return Effect.gen(function* () {
          const authentication =
            packet.d.authentication === undefined
              ? undefined
              : password === undefined
                ? yield* new AuthenticationError({
                    reason: "OBS requires a password, but none was provided",
                  })
                : yield* authenticate(crypto, password, packet.d.authentication);
          yield* write(
            JSON.stringify({
              op: 1,
              d: {
                rpcVersion: packet.d.rpcVersion,
                eventSubscriptions: 0x7fffffff,
                ...(authentication === undefined ? {} : { authentication }),
              },
            }),
          );
        });
      case 2:
        return helloReceived
          ? Deferred.succeed(identified, undefined).pipe(Effect.asVoid)
          : Effect.fail(new ProtocolError({ reason: "Received Identified before Hello" }));
      case 5:
        return PubSub.publish(eventBus, packet.d).pipe(Effect.asVoid);
      case 7: {
        const deferred = pending.get(packet.d.requestId);
        if (deferred === undefined) return Effect.void;
        pending.delete(packet.d.requestId);
        return (
          packet.d.requestStatus.result
            ? Deferred.succeed(deferred, packet.d.responseData)
            : Deferred.fail(
                deferred,
                new RequestError({
                  requestType: packet.d.requestType,
                  code: packet.d.requestStatus.code,
                  comment: packet.d.requestStatus.comment,
                }),
              )
        ).pipe(Effect.asVoid);
      }
    }
  };

  const run = socket
    .runRaw((input) =>
      decodePacket(typeof input === "string" ? input : new TextDecoder().decode(input)).pipe(
        Effect.mapError(
          (cause) =>
            new ProtocolError({ reason: `Invalid OBS WebSocket message: ${cause.message}` }),
        ),
        Effect.flatMap(handlePacket),
      ),
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

  const call: Client["call"] = Effect.fnUntraced(function* (requestType, requestData) {
    if (!connected) return yield* new ConnectionError({ reason: "OBS WebSocket is disconnected" });

    const requestId = `${requestPrefix}-${requestSequence++}`;
    const response = yield* Deferred.make<unknown, CallError>();
    pending.set(requestId, response);
    const packet = JSON.stringify({
      op: 6,
      d: {
        requestType,
        requestId,
        ...(requestData === undefined ? {} : { requestData }),
      },
    });

    return yield* write(packet).pipe(
      Effect.mapError((error) => new ConnectionError({ reason: error.message })),
      Effect.andThen(Deferred.await(response)),
      Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
    );
  });

  return {
    call,
    events: Stream.fromPubSub(eventBus),
    disconnect: Fiber.interrupt(socketFiber),
  };
});
