import { Context, Layer } from "effect";
import { io } from "socket.io-client";

export interface StreamlabsSocket {
  on(event: string, listener: (payload: unknown) => void): unknown;
  off(event: string, listener: (payload: unknown) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export class SocketFactory extends Context.Service<
  SocketFactory,
  {
    readonly create: (token: string) => StreamlabsSocket;
  }
>()("@macrograph/plugin-streamlabs/SocketFactory") {}

export const socketLayer = Layer.succeed(SocketFactory, {
  create: (token) =>
    io("https://sockets.streamlabs.com", {
      query: { token },
      transports: ["websocket"],
      autoConnect: false,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    }),
});
