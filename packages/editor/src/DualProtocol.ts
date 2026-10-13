import { Cause, Effect, Queue, Result, Schedule, Scope, Types } from "effect";
import { RpcClient, RpcMessage, RpcSerialization, RpcServer } from "effect/rpc";
import { Socket } from "effect/socket";

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

const runSocket = (
  socket: Socket.Socket,
  handler: (data: string | Uint8Array) => Effect.Effect<void>,
): Effect.Effect<void, Socket.SocketError, Scope.Scope> =>
  Effect.gen(function* () {
    const reader = yield* socket.reader;
    while (true) {
      const batch = yield* reader.pull;
      yield* Effect.forEach(batch, handler, { discard: true });
    }
  });

const writer = (write: Socket.Writer["write"]): Socket.Writer => ({
  write,
  writeAll: (chunks) => Effect.forEach(chunks, write, { discard: true }),
});

export const frameRpc = (payload: string | Uint8Array): Uint8Array =>
  frame(rpcFrameTag, toBytes(payload));

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
              return Effect.orDie(writeRaw.write(frameRpc(encoded)));
            } catch (cause) {
              const defect = parser.encode(RpcMessage.ResponseDefectEncoded(cause));
              return Effect.orDie(writeRaw.write(frameRpc(defect ?? new Uint8Array())));
            }
          };

          const writeCustom = (data: Uint8Array): Effect.Effect<void> =>
            Effect.orDie(writeRaw.write(frame(customFrameTag, data)));

          clients.set(id, { writeRpc, writeCustom });
          clientIds.add(id);

          const customInput = yield* Queue.make<Uint8Array>();

          const customSocket = Socket.make({
            reader: Effect.succeed({
              pull: Queue.take(customInput).pipe(Effect.map((data) => [data] as const)),
              upgrade: Socket.SocketUpgradeError.unsupported,
            }),
            writer: Effect.sync(() =>
              writer((chunk) =>
                Socket.isCloseEvent(chunk) ? writeRaw.write(chunk) : writeCustom(toBytes(chunk)),
              ),
            ),
          });

          if (onCustom) {
            yield* Effect.forkScoped(onCustom(customSocket));
          }

          yield* runSocket(socket, (data) => {
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
                  return Effect.orDie(writeRaw.write(frameRpc(encoded ?? new Uint8Array())));
                }
              case customFrameTag:
                return Queue.offer(customInput, payload);
              default:
                return Effect.void;
            }
          }).pipe(
            Effect.catchCause((cause) => {
              const failure = Cause.findFail(cause);
              if (
                Result.isSuccess(failure) &&
                failure.success.error.reason._tag === "SocketCloseError"
              ) {
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
        supportsAck: true,
        supportsNotifications: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        codecFor: serialization.codecFor,
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
  const customMessages = yield* Queue.make<Uint8Array>();
  const rpcMessages = yield* Queue.make<Uint8Array, Socket.SocketError>();
  const writeRaw = yield* socket.writer;

  yield* Effect.gen(function* () {
    const readRaw = yield* socket.reader;
    while (true) {
      const batch = yield* readRaw.pull;
      for (const data of batch) {
        const bytes = toBytes(data);
        if (bytes.byteLength === 0) continue;
        const payload = bytes.subarray(1);
        switch (bytes[0]) {
          case rpcFrameTag:
            yield* Queue.offer(rpcMessages, payload);
            break;
          case customFrameTag:
            yield* Queue.offer(customMessages, payload);
            break;
        }
      }
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Queue.failCause(rpcMessages, cause).pipe(Effect.andThen(Effect.failCause(cause))),
    ),
    Effect.forkScoped,
  );

  const rpcSocket = Socket.make({
    reader: Effect.succeed({
      pull: Queue.take(rpcMessages).pipe(Effect.map((message) => [message] as const)),
      upgrade: Socket.SocketUpgradeError.unsupported,
    }),
    writer: Effect.succeed(
      writer((data) => writeRaw.write(Socket.isCloseEvent(data) ? data : frameRpc(data))),
    ),
  });
  // The editor reconnects the whole session, including its streams, after transport failure.
  const protocol = yield* RpcClient.makeProtocolSocket({ retryPolicy: Schedule.recurs(0) }).pipe(
    Effect.provideService(Socket.Socket, rpcSocket),
  );

  const sendCustom = (data: Uint8Array): Effect.Effect<void> =>
    Effect.orDie(writeRaw.write(frame(customFrameTag, data)));

  return {
    protocol,
    customMessages: Queue.asDequeue(customMessages),
    sendCustom,
  };
});
