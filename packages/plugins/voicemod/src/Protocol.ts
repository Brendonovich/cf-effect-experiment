import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope, Semaphore } from "effect";
import { Socket } from "effect/unstable/socket";

import { ConnectionFailed, RequestFailed, type Failure } from "./Definition.ts";

const Packet = Schema.Struct({
  action: Schema.optional(Schema.String),
  actionType: Schema.optional(Schema.String),
  id: Schema.optional(Schema.NullOr(Schema.String)),
  actionID: Schema.optional(Schema.NullOr(Schema.String)),
  actionId: Schema.optional(Schema.NullOr(Schema.String)),
  payload: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  actionObject: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Packet));
export interface Client {
  readonly call: (
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<Readonly<Record<string, unknown>>, Failure>;
  readonly send: (
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void, Failure>;
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
  address: string,
): Effect.fn.Return<Client, Failure, Scope.Scope | Socket.WebSocketConstructor> {
  const url = yield* validateUrl(address);
  const socket = yield* Socket.makeWebSocket(url, { closeCodeIsError: () => true });
  const write = yield* socket.writer;
  const opened = yield* Deferred.make<void, Failure>();
  const closed = yield* Deferred.make<void>();
  const disconnected = Deferred.await(closed).pipe(
    Effect.andThen(Effect.fail(new ConnectionFailed({ reason: "Voicemod is disconnected." }))),
  );
  const lock = yield* Semaphore.make(1);
  let sequence = 0;
  let connected = true;
  let pending:
    | {
        readonly id: string;
        readonly action: string;
        readonly responseType: string;
        readonly response: Deferred.Deferred<Readonly<Record<string, unknown>>, Failure>;
      }
    | undefined;
  const fail = Effect.fnUntraced(function* (error: Failure) {
    connected = false;
    yield* Deferred.fail(opened, error);
    if (pending) yield* Deferred.fail(pending.response, error);
    yield* Deferred.succeed(closed, undefined);
  });
  yield* Effect.addFinalizer(() =>
    fail(new ConnectionFailed({ reason: "Voicemod is disconnected." })),
  );
  const reader = yield* socket
    .runRaw(
      (input) =>
        decode(typeof input === "string" ? input : new TextDecoder().decode(input)).pipe(
          Effect.mapError(
            () => new ConnectionFailed({ reason: "Invalid Voicemod protocol message." }),
          ),
          Effect.flatMap((packet) => {
            const request = pending;
            const type = packet.action ?? packet.actionType;
            const id = packet.id ?? packet.actionID ?? packet.actionId;
            const changerCompletion =
              request?.action === "toggleVoiceChanger" &&
              (type === "voiceChangerEnabledEvent" || type === "voiceChangerDisabledEvent");
            if (
              !request ||
              (type !== request.responseType && !changerCompletion) ||
              (id != null && id !== request.id)
            )
              return Effect.void;
            const data = changerCompletion
              ? { value: type === "voiceChangerEnabledEvent" }
              : (packet.payload ?? packet.actionObject);
            if (!data)
              return Deferred.fail(
                request.response,
                new RequestFailed({
                  action: request.action,
                  reason: "Voicemod response has no payload.",
                }),
              ).pipe(Effect.asVoid);
            return Deferred.succeed(request.response, data).pipe(Effect.asVoid);
          }),
        ),
      { onOpen: Deferred.succeed(opened, undefined).pipe(Effect.asVoid) },
    )
    .pipe(
      Effect.catchCause(() => fail(new ConnectionFailed({ reason: "Voicemod connection lost." }))),
      Effect.ensuring(fail(new ConnectionFailed({ reason: "Voicemod is disconnected." }))),
      Effect.forkScoped,
    );
  yield* Deferred.await(opened);
  const send = Effect.fnUntraced(function* (
    action: string,
    payload: Readonly<Record<string, unknown>>,
    id = `macrograph-${sequence++}`,
  ) {
    if (!connected) return yield* new ConnectionFailed({ reason: "Voicemod is disconnected." });
    yield* Effect.suspend(() => write(JSON.stringify({ action, id, payload }))).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.fail(new ConnectionFailed({ reason: "Could not send Voicemod request." })),
      ),
      Effect.raceFirst(disconnected),
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(new ConnectionFailed({ reason: "Voicemod send timed out." })),
      }),
    );
  });
  return {
    closed: Deferred.await(closed),
    send,
    // Queries and acknowledged commands share one slot because response IDs may be absent.
    call: Effect.fnUntraced(function* (action, payload) {
      const id = `macrograph-${sequence++}`;
      const response = yield* Deferred.make<Readonly<Record<string, unknown>>, Failure>();
      pending = {
        id,
        action,
        response,
        responseType:
          action === "getVoiceChangerStatus"
            ? "toggleVoiceChanger"
            : action === "getHearMyselfStatus"
              ? "toggleHearMyVoice"
              : action,
      };
      return yield* send(action, payload, id).pipe(
        Effect.andThen(Deferred.await(response)),
        Effect.raceFirst(disconnected),
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () =>
            Effect.fail(new RequestFailed({ action, reason: "Voicemod request timed out." })),
        }),
        // A late ID-less response must never satisfy a subsequent query after cancellation.
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? fail(
                new ConnectionFailed({
                  reason: "Voicemod query was canceled or failed. Reconnect to continue.",
                }),
              ).pipe(Effect.andThen(Fiber.interrupt(reader)))
            : Effect.void,
        ),
        Effect.ensuring(
          Effect.sync(() => {
            pending = undefined;
          }),
        ),
      );
    }, lock.withPermit),
  };
});
