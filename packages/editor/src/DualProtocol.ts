import { Cause, Effect, Queue, Result, Scope, Stream, Types } from "effect";
import { RpcClient, RpcMessage, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

export const rpcFrameTag = 0;
export const customFrameTag = 1;

const enc = new TextEncoder();

const frame = (tag: number, payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(1 + payload.byteLength);
  out[0] = tag;
  out.set(payload, 1);
  return out;
};

const toBytes = (data: string | Uint8Array): Uint8Array =>
  typeof data === "string" ? enc.encode(data) : data;

export const frameRpc = (payload: string | Uint8Array): Uint8Array =>
  frame(rpcFrameTag, toBytes(payload));

const isSocketClose = (error: unknown) => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return false;
  if (error._tag !== "SocketError" || !("reason" in error)) return false;
  const reason = error.reason;
  return (
    typeof reason === "object" &&
    reason !== null &&
    "_tag" in reason &&
    reason._tag === "SocketCloseError"
  );
};

export const makeDualServerProtocol = (
  onCustom?: (customSocket: Socket.Socket) => Effect.Effect<void, never, Scope.Scope>,
): Effect.Effect<
  {
    readonly protocol: RpcServer.Protocol["Service"];
    readonly onSocket: (
      socket: Socket.Socket,
      headers?: ReadonlyArray<[string, string]>,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly broadcastCustom: (data: Uint8Array) => Effect.Effect<void>;
  },
  never,
  RpcSerialization.RpcSerialization
> =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization;
    const disconnects = yield* Queue.make<number>();

    let clientId = 0;
    const clients = new Map<
      number,
      {
        readonly writeRpc: (response: RpcMessage.FromServerEncoded) => Effect.Effect<void>;
        readonly writeCustom: (data: Uint8Array) => Effect.Effect<void>;
      }
    >();
    const clientIds = new Set<number>();
    let writeRequest!: (
      clientId: number,
      message: RpcMessage.FromClientEncoded,
    ) => Effect.Effect<void>;

    const onSocket = (
      socket: Socket.Socket,
      headers?: ReadonlyArray<[string, string]>,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const parser = serialization.makeUnsafe();
          const id = clientId++;

          yield* Scope.addFinalizerExit(scope, () => {
            clients.delete(id);
            clientIds.delete(id);
            return Queue.offer(disconnects, id);
          });

          const writeRaw = yield* socket.writer;

          const writeRpc = (response: RpcMessage.FromServerEncoded): Effect.Effect<void> => {
            try {
              const encoded = parser.encode(response);
              if (encoded === undefined) return Effect.void;
              return Effect.orDie(writeRaw(frameRpc(encoded)));
            } catch (cause) {
              const defect = parser.encode(RpcMessage.ResponseDefectEncoded(cause));
              return Effect.orDie(writeRaw(frameRpc(defect ?? new Uint8Array())));
            }
          };

          const writeCustom = (data: Uint8Array): Effect.Effect<void> =>
            Effect.orDie(writeRaw(frame(customFrameTag, data)));

          clients.set(id, { writeRpc, writeCustom });
          clientIds.add(id);

          const customInput = yield* Queue.make<Uint8Array>();

          const customSocket = Socket.make({
            runRaw: (handler) =>
              Stream.fromQueue(customInput).pipe(
                Stream.runForEach((data) => handler(data) ?? Effect.void),
              ),
            writer: Effect.sync(
              () => (chunk) =>
                Socket.isCloseEvent(chunk) ? writeRaw(chunk) : writeCustom(toBytes(chunk)),
            ),
          });

          if (onCustom) {
            yield* Effect.forkScoped(onCustom(customSocket));
          }

          yield* socket
            .runRaw((data) => {
              const bytes = toBytes(data);
              if (bytes.byteLength === 0) return Effect.void;

              const tag = bytes[0];
              const payload = bytes.subarray(1);

              switch (tag) {
                case rpcFrameTag:
                  try {
                    const decoded = parser.decode(
                      payload,
                    ) as ReadonlyArray<RpcMessage.FromClientEncoded>;
                    if (decoded.length === 0) return Effect.void;

                    return Effect.forEach(
                      decoded,
                      (message) => {
                        if (message._tag === "Request" && headers) {
                          (message as Types.Mutable<RpcMessage.RequestEncoded>).headers =
                            headers.concat(message.headers);
                        }
                        return writeRequest(id, message);
                      },
                      { discard: true },
                    );
                  } catch (cause) {
                    const encoded = parser.encode(RpcMessage.ResponseDefectEncoded(cause));
                    return Effect.orDie(writeRaw(frameRpc(encoded ?? new Uint8Array())));
                  }
                case customFrameTag:
                  return Queue.offer(customInput, payload);
                default:
                  return Effect.void;
              }
            })
            .pipe(
              Effect.catchCause((cause) => {
                const failure = Cause.findFail(cause);
                if (Result.isSuccess(failure) && isSocketClose(failure.success)) {
                  return Effect.void;
                }
                return Effect.failCause(cause);
              }),
              Effect.orDie,
            );
        }),
      );

    const protocol = yield* RpcServer.Protocol.make((writeRequest_) => {
      writeRequest = writeRequest_;
      return Effect.succeed({
        disconnects,
        send: (
          cid: number,
          response: RpcMessage.FromServerEncoded,
          _transferables?: ReadonlyArray<globalThis.Transferable>,
        ): Effect.Effect<void> => {
          const client = clients.get(cid);
          if (!client) return Effect.void;
          return client.writeRpc(response);
        },
        end: (_cid: number): Effect.Effect<void> => Effect.void,
        clientIds: Effect.sync(() => clientIds),
        initialMessage: Effect.succeedNone,
        supportsAck: false,
        supportsTransferables: false,
        supportsSpanPropagation: true,
      });
    });

    const broadcastCustom = (data: Uint8Array): Effect.Effect<void> =>
      Effect.forEach(clients, ([_id, client]) => client.writeCustom(data), {
        discard: true,
      });

    return {
      protocol,
      onSocket,
      broadcastCustom,
    };
  });

export const makeDualClientProtocol: Effect.Effect<
  {
    readonly protocol: RpcClient.Protocol["Service"];
    readonly customMessages: Queue.Dequeue<Uint8Array>;
    readonly sendCustom: (data: Uint8Array) => Effect.Effect<void>;
  },
  never,
  RpcSerialization.RpcSerialization | Socket.Socket | Scope.Scope
> = Effect.gen(function* () {
  const socket = yield* Socket.Socket;
  const serialization = yield* RpcSerialization.RpcSerialization;
  const customMessages = yield* Queue.make<Uint8Array>();
  const requestClientMap = new Map<string | number, number>();
  const writeRaw = yield* socket.writer;

  const protocol = yield* RpcClient.Protocol.make(
    (
      writeResponse: (
        clientId: number,
        response: RpcMessage.FromServerEncoded,
      ) => Effect.Effect<void>,
    ) =>
      Effect.gen(function* () {
        const parser = serialization.makeUnsafe();

        yield* socket
          .runRaw((data) => {
            const bytes = toBytes(data);
            if (bytes.byteLength === 0) return Effect.void;

            const tag = bytes[0];
            const payload = bytes.subarray(1);

            if (tag === rpcFrameTag) {
              try {
                const responses = parser.decode(
                  payload,
                ) as ReadonlyArray<RpcMessage.FromServerEncoded>;
                if (responses.length === 0) return Effect.void;

                return Effect.forEach(
                  responses,
                  (response) => {
                    if (response._tag === "Pong") return Effect.void;
                    const cid =
                      "requestId" in response ? (requestClientMap.get(response.requestId) ?? 0) : 0;
                    if (response._tag === "Exit") requestClientMap.delete(response.requestId);
                    return writeResponse(cid, response);
                  },
                  { discard: true },
                );
              } catch {
                return Effect.void;
              }
            } else if (tag === customFrameTag) {
              return Queue.offer(customMessages, payload);
            }

            return Effect.void;
          })
          .pipe(
            Effect.catchCause((cause) => {
              const failure = Cause.findFail(cause);
              if (Result.isSuccess(failure) && isSocketClose(failure.success)) {
                return Effect.void;
              }
              return Effect.failCause(cause);
            }),
            Effect.orDie,
            Effect.forkScoped,
          );

        return {
          send: (
            _clientId: number,
            request: RpcMessage.FromClientEncoded,
            _transferables?: ReadonlyArray<globalThis.Transferable>,
          ): Effect.Effect<void, never> => {
            if (request._tag === "Request") {
              requestClientMap.set(request.id, _clientId);
            }
            const encoded = parser.encode(request);
            if (encoded === undefined) return Effect.void;
            return Effect.orDie(writeRaw(frameRpc(encoded)));
          },
          supportsAck: false,
          supportsTransferables: false,
        };
      }),
  );

  const sendCustom = (data: Uint8Array): Effect.Effect<void> =>
    Effect.orDie(writeRaw(frame(customFrameTag, data)));

  return {
    protocol,
    customMessages: Queue.asDequeue(customMessages),
    sendCustom,
  };
});
