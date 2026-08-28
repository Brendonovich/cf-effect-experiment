import { Context, Layer } from "effect";
import EulerStreamApiClient from "tiktok-live-api-sdk";
import { ControlEvent, TikTokLiveConnection, VERSION, WebcastEvent } from "tiktok-live-connector";

import type { TransportEvent, TransportMode } from "./Definition.ts";

import { createManagedClient } from "./Managed.ts";
export { createManagedClient, type ManagedSocket } from "./Managed.ts";

export type ClientEvent =
  | TransportEvent
  | "connected"
  | "connecting"
  | "roomInfo"
  | "disconnected"
  | "error";
export interface TikTokClient {
  on(event: ClientEvent, listener: (payload: unknown) => void): unknown;
  off(event: ClientEvent, listener: (payload: unknown) => void): unknown;
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
}
export class ClientFactory extends Context.Service<
  ClientFactory,
  {
    readonly create: (config: {
      readonly username: string;
      readonly apiKey: string;
      readonly mode: TransportMode;
    }) => TikTokClient;
  }
>()("@macrograph/plugin-tiktok-euler-stream/ClientFactory") {}

const events = {
  chat: WebcastEvent.CHAT,
  gift: WebcastEvent.GIFT,
  member: WebcastEvent.MEMBER,
  follow: WebcastEvent.FOLLOW,
  share: WebcastEvent.SHARE,
  social: WebcastEvent.SOCIAL,
  like: WebcastEvent.LIKE,
  roomUser: WebcastEvent.ROOM_USER,
  questionNew: WebcastEvent.QUESTION_NEW,
  emote: WebcastEvent.EMOTE,
  envelope: WebcastEvent.ENVELOPE,
  liveIntro: WebcastEvent.LIVE_INTRO,
  linkMicBattle: WebcastEvent.LINK_MIC_BATTLE,
  linkMicArmies: WebcastEvent.LINK_MIC_ARMIES,
  superFan: WebcastEvent.SUPER_FAN,
  superFanJoin: WebcastEvent.SUPER_FAN_JOIN,
  streamEnd: WebcastEvent.STREAM_END,
  goalUpdate: WebcastEvent.GOAL_UPDATE,
  roomMessage: WebcastEvent.ROOM_MESSAGE,
  connected: ControlEvent.CONNECTED,
  disconnected: ControlEvent.DISCONNECTED,
  error: ControlEvent.ERROR,
} as const;

export const clientLayer = Layer.succeed(ClientFactory, {
  create: ({ username, apiKey, mode }) => {
    if (mode === "managed") return createManagedClient({ username, apiKey });
    const abort = new AbortController();
    // signApiKey mutates a global cached client in the connector. Never use it for project secrets.
    const eulerApiInstance = new EulerStreamApiClient({
      apiKey,
      basePath: "https://api.eulerstream.com",
      baseOptions: {
        timeout: 15000,
        signal: abort.signal,
        headers: { "User-Agent": `tiktok-live-connector/${VERSION}` },
        validateStatus: () => true,
      },
    });
    const connection = new TikTokLiveConnection(username, {
      eulerApiInstance,
      processInitialData: false,
      enableExtendedGiftInfo: false,
      fetchRoomInfoOnConnect: true,
      authenticateWs: false,
      wsClientOptions: { handshakeTimeout: 15000 },
    });
    return {
      on: (event, listener) =>
        event === "connecting" || event === "roomInfo"
          ? undefined
          : connection.on(events[event], listener),
      off: (event, listener) =>
        event === "connecting" || event === "roomInfo"
          ? undefined
          : connection.off(events[event], listener),
      connect: () => connection.connect(),
      disconnect: async () => {
        abort.abort();
        if (!connection.isConnected) connection.wsClient?.terminate();
        await connection.disconnect();
      },
    };
  },
});
