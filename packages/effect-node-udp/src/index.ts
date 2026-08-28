import { Cause, Context, Effect, Layer, Queue, Schema, type Scope } from "effect";
import { createSocket } from "node:dgram";
import { isIP } from "node:net";

export interface Address {
  readonly address: string;
  readonly port: number;
}

export interface Datagram {
  readonly data: Uint8Array;
  readonly peer: Address;
}

export class UdpError extends Schema.TaggedError<UdpError>()("UdpError", {
  reason: Schema.Literals(["Open", "Bind", "Send", "Receive", "Overflow", "Closed"]),
  cause: Schema.Defect(),
}) {}

export interface Socket {
  readonly localAddress: Address;
  readonly send: (data: Uint8Array, peer: Address) => Effect.Effect<void, UdpError>;
  readonly receive: Effect.Effect<Datagram, UdpError>;
  readonly close: Effect.Effect<void>;
}

export interface OpenOptions {
  readonly type?: "udp4" | "udp6";
  readonly address?: string;
  readonly port?: number;
  readonly capacity?: number;
}

export class UdpSocket extends Context.Service<
  UdpSocket,
  { readonly open: (options?: OpenOptions) => Effect.Effect<Socket, UdpError, Scope.Scope> }
>()("effect-node-udp/UdpSocket") {}

/** Injectable Node boundary for deterministic transport and lifecycle tests. */
export interface RawSocket {
  on(event: "message", listener: (data: Uint8Array, peer: Address) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "listening" | "close", listener: () => void): unknown;
  off(event: "message", listener: (data: Uint8Array, peer: Address) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(event: "listening" | "close", listener: () => void): unknown;
  bind(port: number, address: string): void;
  address(): Address;
  send(
    data: Uint8Array,
    port: number,
    address: string,
    callback: (error: Error | null) => void,
  ): void;
  close(): void;
}

export class SocketFactory extends Context.Service<
  SocketFactory,
  (type: "udp4" | "udp6") => RawSocket
>()("effect-node-udp/SocketFactory") {}

export const layer = Layer.effect(UdpSocket)(
  Effect.gen(function* () {
    const factory = yield* SocketFactory;
    return {
      open: (options: OpenOptions = {}) =>
        Effect.uninterruptibleMask((restore) => {
          let release: Effect.Effect<void> = Effect.void;
          // Catch outside restore so interruption cleans up under the mask. Success transfers
          // directly to the caller without a separately scheduled success-finalizer gap.
          return restore(
            Effect.gen(function* () {
              const type = options.type === undefined ? "udp4" : options.type;
              if (type !== "udp4" && type !== "udp6")
                return yield* new UdpError({ reason: "Open", cause: "Type must be udp4 or udp6" });
              const address =
                options.address === undefined
                  ? type === "udp6"
                    ? "::"
                    : "0.0.0.0"
                  : options.address;
              const port = options.port === undefined ? 0 : options.port;
              if (!Number.isInteger(port) || port < 0 || port > 65535)
                return yield* new UdpError({
                  reason: "Bind",
                  cause: "Bind port must be an integer from 0 to 65535",
                });
              if (isIP(address) !== (type === "udp4" ? 4 : 6))
                return yield* new UdpError({
                  reason: "Bind",
                  cause: "Bind address must be an IP literal matching the socket type",
                });
              const capacity = options.capacity === undefined ? 256 : options.capacity;
              if (!Number.isSafeInteger(capacity) || capacity < 1)
                return yield* new UdpError({
                  reason: "Open",
                  cause: "Capacity must be a positive integer",
                });
              const queue = yield* Queue.bounded<Datagram, UdpError>(capacity);
              // Allocation and listener installation are acquired before the interruptible bind.
              const state = yield* Effect.acquireRelease(
                Effect.try({
                  try: () => {
                    const raw = factory(type);
                    let terminal: UdpError | undefined;
                    let listening = false;
                    let bindResume: ((effect: Effect.Effect<void, UdpError>) => void) | undefined;
                    const sends = new Set<(error: UdpError) => void>();
                    const terminate = (error: UdpError, shouldClose = true) => {
                      if (terminal) return;
                      terminal = error;
                      // Resuming callbacks can run fibers synchronously, so close before waking them.
                      if (shouldClose) closeRaw();
                      // Discard buffered datagrams so every taker sees the terminal failure immediately.
                      while (Queue.takeUnsafe(queue) !== undefined) {}
                      Queue.failCauseUnsafe(queue, Cause.fail(error));
                      bindResume?.(Effect.fail(error));
                      bindResume = undefined;
                      for (const fail of sends) fail(error);
                      sends.clear();
                    };
                    const cleanup = () => {
                      raw.off("message", onMessage);
                      raw.off("error", onError);
                      raw.off("listening", onListening);
                      raw.off("close", onClose);
                    };
                    const closeRaw = () => {
                      try {
                        // Node defers close during bind. Keep error/close listeners until it finishes.
                        raw.close();
                      } catch {
                        // Unbound/failed-bind and already-closed sockets have no live handle.
                        cleanup();
                      }
                    };
                    const onMessage = (data: Uint8Array, peer: Address) => {
                      if (terminal) return;
                      if (
                        !Queue.offerUnsafe(queue, {
                          data: Uint8Array.from(data),
                          peer: { address: peer.address, port: peer.port },
                        })
                      ) {
                        terminate(
                          new UdpError({
                            reason: "Overflow",
                            cause: `Receive capacity ${capacity} exceeded`,
                          }),
                        );
                      }
                    };
                    const onError = (cause: Error) => {
                      // Also retry close if a cancelled bind subsequently fails instead of listening.
                      if (terminal) closeRaw();
                      else
                        terminate(new UdpError({ reason: listening ? "Receive" : "Bind", cause }));
                    };
                    const onListening = () => {
                      listening = true;
                      if (terminal) return;
                      bindResume?.(Effect.void);
                      bindResume = undefined;
                    };
                    const onClose = () => {
                      cleanup();
                      terminate(
                        new UdpError({ reason: "Closed", cause: "UDP socket closed" }),
                        false,
                      );
                    };
                    try {
                      raw.on("message", onMessage);
                      raw.on("error", onError);
                      raw.on("listening", onListening);
                      raw.on("close", onClose);
                    } catch (cause) {
                      terminate(new UdpError({ reason: "Open", cause }));
                      cleanup();
                      throw cause;
                    }

                    const close = Effect.sync(() => {
                      if (terminal) return;
                      terminate(new UdpError({ reason: "Closed", cause: "UDP socket closed" }));
                    });
                    const bind = Effect.callback<void, UdpError>((resume) => {
                      if (terminal) return resume(Effect.fail(terminal));
                      bindResume = resume;
                      try {
                        raw.bind(port, address);
                      } catch (cause) {
                        terminate(new UdpError({ reason: "Bind", cause }));
                      }
                      return Effect.sync(() => {
                        bindResume = undefined;
                      });
                    });
                    const send: Socket["send"] = (data, peer) =>
                      Effect.callback<void, UdpError>((resume, signal) => {
                        if (terminal) return resume(Effect.fail(terminal));
                        if (signal.aborted) return;
                        const fail = (error: UdpError) => resume(Effect.fail(error));
                        sends.add(fail);
                        try {
                          // Validate original inputs before Node normalizes empty addresses or ports.
                          if (isIP(peer.address) === 0)
                            throw new Error("Peer address must be an IP literal");
                          if (!Number.isInteger(peer.port) || peer.port < 1 || peer.port > 65535)
                            throw new Error("Peer port must be an integer from 1 to 65535");
                          raw.send(data, peer.port, peer.address, (cause) => {
                            if (!sends.delete(fail) || signal.aborted) return;
                            if (cause) {
                              const error = new UdpError({ reason: "Send", cause });
                              terminate(error);
                              resume(Effect.fail(error));
                            } else resume(Effect.void);
                          });
                        } catch (cause) {
                          terminate(new UdpError({ reason: "Send", cause }));
                        }
                        return Effect.sync(() => {
                          sends.delete(fail);
                        });
                      });
                    const receive = Effect.suspend(() =>
                      terminal
                        ? Effect.fail(terminal)
                        : Queue.take(queue).pipe(
                            Effect.flatMap((datagram) =>
                              terminal ? Effect.fail(terminal) : Effect.succeed(datagram),
                            ),
                          ),
                    );
                    // Set under acquireRelease's mask, before interruption can discard its result.
                    release = close;
                    return { raw, bind, close, send, receive };
                  },
                  catch: (cause) => new UdpError({ reason: "Open", cause }),
                }),
                (state) => state.close,
              );
              yield* state.bind;
              const localAddress = yield* Effect.try({
                try: () => {
                  const address = state.raw.address();
                  return { address: address.address, port: address.port };
                },
                catch: (cause) => new UdpError({ reason: "Bind", cause }),
              });
              return { localAddress, send: state.send, receive: state.receive, close: state.close };
            }),
          ).pipe(
            Effect.catchCause((cause) => release.pipe(Effect.andThen(Effect.failCause(cause)))),
          );
        }),
    };
  }),
);

export const nodeLayer = layer.pipe(
  Layer.provide(
    Layer.succeed(SocketFactory)((type) =>
      createSocket({
        type,
        // Synchronous numeric lookup prevents Node from submitting a send after cancellation
        // while an asynchronous DNS lookup is pending.
        lookup: (address, _options, callback) => {
          const family = isIP(address);
          if (family === 0) callback(new Error("UDP addresses must be IP literals"), "", 0);
          else callback(null, address, family);
        },
      }),
    ),
  ),
);
