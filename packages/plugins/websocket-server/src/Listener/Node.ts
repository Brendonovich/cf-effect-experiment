import { NodeSocketServer } from "@effect/platform-node";
import { Cause, Context, Deferred, Effect, Layer, Queue } from "effect";
import { Socket } from "effect/unstable/socket";

import { Adapter, type Client, type Listener, ListenerError } from "../Listener.ts";

const reason = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "object" && error !== null && "reason" in error)
    return reason(error.reason, fallback);
  return fallback;
};

export const layer = Layer.succeed(Adapter, {
  listen: ({ host, port, maxMessageBytes, maxBufferedBytes, maxPendingMessages }) =>
    NodeSocketServer.makeWebSocket({ host, port, maxPayload: maxMessageBytes }).pipe(
      Effect.map(
        (server): Listener => ({
          run: (onClient: (client: Client) => Effect.Effect<void>) =>
            server
              .run((socket) =>
                Effect.gen(function* () {
                  const writer = yield* socket.writer;
                  const raw = yield* Effect.withFiber((fiber) =>
                    Effect.succeed(Context.getUnsafe(fiber.context, Socket.WebSocket)),
                  );
                  const closed = yield* Deferred.make<void>();
                  const onClose = () => Deferred.doneUnsafe(closed, Effect.void);
                  raw.addEventListener("close", onClose, { once: true });
                  yield* onClient({
                    closed: Deferred.await(closed),
                    send: (message: string) =>
                      Effect.suspend(() => {
                        if (raw.readyState !== 1)
                          return Effect.fail(
                            new ListenerError({ reason: "The WebSocket peer is not open" }),
                          );
                        const messageBytes = new TextEncoder().encode(message).byteLength;
                        if (raw.bufferedAmount + messageBytes > maxBufferedBytes) {
                          raw.close(1013, "Outbound buffer limit exceeded");
                          return Effect.fail(
                            new ListenerError({ reason: "Outbound buffer limit exceeded" }),
                          );
                        }
                        return writer(message).pipe(
                          Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                              ? Effect.interrupt
                              : Effect.fail(
                                  new ListenerError({
                                    reason: reason(cause, "WebSocket send failed"),
                                  }),
                                ),
                          ),
                        );
                      }),
                    run: (onMessage: (message: unknown) => Effect.Effect<void>) =>
                      Effect.gen(function* () {
                        const messages = yield* Queue.dropping<string | Uint8Array>(
                          maxPendingMessages,
                        );
                        const read = socket.runRaw((message) =>
                          Queue.offer(messages, message).pipe(
                            Effect.flatMap((accepted) =>
                              accepted
                                ? Effect.void
                                : Effect.fail(
                                    new ListenerError({
                                      reason: "Inbound message queue limit exceeded",
                                    }),
                                  ),
                            ),
                          ),
                        );
                        const consume = Effect.forever(
                          Queue.take(messages).pipe(Effect.flatMap(onMessage)),
                        );
                        yield* Effect.raceFirst(read, consume).pipe(
                          Effect.mapError((error) =>
                            error instanceof ListenerError
                              ? error
                              : new ListenerError({
                                  reason: reason(error, "WebSocket receive failed"),
                                }),
                          ),
                        );
                      }),
                  });
                }),
              )
              .pipe(
                Effect.mapError((error) =>
                  error instanceof ListenerError
                    ? error
                    : new ListenerError({ reason: error.message }),
                ),
              ),
        }),
      ),
      Effect.mapError(
        (error) =>
          new ListenerError({ reason: reason(error, "WebSocket listener failed to start") }),
      ),
    ),
});

export default layer;
