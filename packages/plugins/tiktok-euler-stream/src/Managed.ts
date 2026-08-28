import { Option, Schema } from "effect";
import { Buffer } from "node:buffer";
import WebSocket from "ws";

import type { StateError, TransportEvent } from "./Definition.ts";
import type { ClientEvent, TikTokClient } from "./Transport.ts";

export interface ManagedSocket {
  readonly readyState: number;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: (code: number) => void): unknown;
  on(event: "error", listener: () => void): unknown;
  off(event: "message", listener: (data: unknown) => void): unknown;
  off(event: "close", listener: (code: number) => void): unknown;
  off(event: "error", listener: () => void): unknown;
  terminate(): unknown;
}

const Message = Schema.Struct({ type: Schema.String, data: Schema.Unknown });
const Frame = Schema.Union([Schema.Struct({ messages: Schema.Array(Schema.Unknown) }), Message]);
const Id = Schema.Union([Schema.String, Schema.Int]);
const RoomInfo = Schema.Struct({ roomId: Schema.optional(Schema.NullOr(Id)) });
const RoomStatus = Schema.Struct({
  state: Schema.Literals(["connected", "connecting", "reconnecting", "ended", "offline", "error"]),
  roomId: Schema.optional(Schema.NullOr(Id)),
});
const Social = Schema.Struct({
  shareType: Schema.optional(Schema.NullOr(Id)),
  displayStyle: Schema.optional(Id),
  action: Schema.optional(Id),
});
const webcast = new Map<string, TransportEvent>([
  ["WebcastChatMessage", "chat"],
  ["WebcastGiftMessage", "gift"],
  ["WebcastMemberMessage", "member"],
  ["WebcastLikeMessage", "like"],
]);

/** The Electron branch's managed Euler JSON protocol, not the connector's signing API. */
export function createManagedClient(
  config: { readonly username: string; readonly apiKey: string },
  createSocket: (url: string) => ManagedSocket = (url) =>
    new WebSocket(url, {
      handshakeTimeout: 15000,
      maxPayload: 1_048_576,
      followRedirects: false,
    }),
): TikTokClient {
  const listeners = new Map<ClientEvent, Set<(payload: unknown) => void>>();
  const pending = Promise.withResolvers<unknown>();
  let socket: ManagedSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let started = false;
  let roomId = "";
  let connected = false;
  let closing: Promise<void> | undefined;
  const emit = (event: ClientEvent, payload: unknown) => {
    if (!disposed) for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const settle = () => {
    clearTimeout(timer);
    timer = undefined;
    // State is delivered through callbacks; resolving with a snapshot could overwrite a later
    // status in the same batched message when the engine's promise continuation runs.
    pending.resolve(undefined);
  };
  const disconnect = (): Promise<void> => {
    if (closing) return closing;
    disposed = true;
    settle();
    if (!socket) return Promise.resolve();
    const current = socket;
    current.off("message", onMessage);
    current.off("close", onClose);
    current.off("error", onError);
    if (current.readyState === 3) return Promise.resolve();
    closing = new Promise<void>((resolve) => {
      // ws can emit an error while aborting its handshake. Keep only a teardown guard until close.
      const ignoreError = () => {};
      const done = () => {
        current.off("error", ignoreError);
        current.off("close", done);
        resolve();
      };
      current.on("error", ignoreError);
      current.on("close", done);
      current.terminate();
    });
    return closing;
  };
  const fail = (reason: typeof StateError.Type) => {
    emit("error", { reason });
    void disconnect().catch(() => {});
  };
  const onError = () => fail("connection-failed");
  const onClose = (code: number) => {
    if (disposed) return;
    if (code === 4404) emit("error", { reason: "creator-offline" });
    else if (code === 4401 || code === 4403) emit("error", { reason: "authentication-failed" });
    else if (code === 4556 || code === 1011) emit("error", { reason: "provider-failed" });
    else if (code !== 1000 && code !== 4005) emit("error", { reason: "connection-failed" });
    else emit("disconnected", {});
    void disconnect().catch(() => {});
  };
  const onMessage = (raw: unknown) => {
    if (disposed) return;
    if ((typeof raw !== "string" && !Buffer.isBuffer(raw)) || raw.length > 1_048_576) {
      fail("invalid-payload");
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(raw.toString());
    } catch {
      fail("invalid-payload");
      return;
    }
    const frame = Schema.decodeUnknownOption(Frame)(input);
    if (Option.isNone(frame)) {
      fail("invalid-payload");
      return;
    }
    const messages = "messages" in frame.value ? frame.value.messages : [frame.value];
    for (const input of messages) {
      if (disposed) return;
      const result = Schema.decodeUnknownOption(Message)(input);
      if (Option.isNone(result) || result.value.data === undefined) {
        fail("invalid-payload");
        return;
      }
      const { type, data } = result.value;
      switch (type) {
        case "roomInfo": {
          const info = Schema.decodeUnknownOption(RoomInfo)(data);
          if (Option.isNone(info)) {
            fail("invalid-payload");
            return;
          }
          if (info.value.roomId != null) {
            roomId = String(info.value.roomId);
            emit("roomInfo", { roomId });
          }
          break;
        }
        case "room.status": {
          const status = Schema.decodeUnknownOption(RoomStatus)(data);
          if (Option.isNone(status)) {
            fail("invalid-payload");
            return;
          }
          if (status.value.roomId != null) roomId = String(status.value.roomId);
          switch (status.value.state) {
            case "connected":
              connected = true;
              emit("connected", { roomId });
              settle();
              break;
            case "connecting":
            case "reconnecting":
              connected = false;
              emit("connecting", { roomId });
              break;
            case "ended":
            case "offline":
              emit("disconnected", {});
              void disconnect().catch(() => {});
              break;
            case "error":
              fail("provider-failed");
              break;
          }
          break;
        }
        case "tiktok.connect":
          connected = true;
          emit("connected", { roomId });
          settle();
          break;
        case "tiktok.disconnect":
          emit("disconnected", {});
          void disconnect().catch(() => {});
          break;
        case "WebcastSocialMessage": {
          const social = Schema.decodeUnknownOption(Social)(data);
          if (Option.isNone(social)) {
            fail("invalid-payload");
            return;
          }
          // Preserve the branch's managed-message routing, including a present shareType of zero.
          const isShare =
            social.value.shareType != null ||
            Number(social.value.displayStyle) === 2 ||
            Number(social.value.action) === 3;
          emit(isShare ? "share" : "follow", data);
          break;
        }
        default: {
          const kind = webcast.get(type);
          if (kind) emit(kind, data);
        }
      }
    }
  };
  return {
    on: (event, listener) => {
      const group = listeners.get(event) ?? new Set();
      group.add(listener);
      listeners.set(event, group);
    },
    off: (event, listener) => {
      listeners.get(event)?.delete(listener);
    },
    connect: () => {
      if (started || disposed) return pending.promise;
      started = true;
      if (!config.apiKey) {
        fail("authentication-failed");
        return pending.promise;
      }
      const url = new URL("wss://ws.eulerstream.com");
      url.searchParams.set("uniqueId", config.username);
      url.searchParams.set("apiKey", config.apiKey);
      try {
        socket = createSocket(url.toString());
        socket.on("message", onMessage);
        socket.on("close", onClose);
        socket.on("error", onError);
        timer = setTimeout(() => {
          if (!connected) fail("connection-failed");
        }, 30000);
      } catch {
        fail("connection-failed");
      }
      return pending.promise;
    },
    disconnect,
  };
}
