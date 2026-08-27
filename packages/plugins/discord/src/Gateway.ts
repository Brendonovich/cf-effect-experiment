import { Context, Layer, Option, Schema } from "effect";

import { type ClientState, MessageReceived } from "./Definition.ts";

export interface GatewaySocket {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface GatewayOptions {
  readonly token: string;
  readonly messageContent: boolean;
  readonly onMessage: (message: MessageReceived) => void;
  readonly onStatus: (
    status: (typeof ClientState.Type)["status"],
    error?: (typeof ClientState.Type)["error"],
  ) => void;
}

export class Gateway extends Context.Service<
  Gateway,
  {
    readonly start: (options: GatewayOptions) => () => void;
  }
>()("@macrograph/plugin-discord/Gateway") {}

const Envelope = Schema.Struct({
  op: Schema.Int,
  d: Schema.optional(Schema.Unknown),
  s: Schema.optional(Schema.NullOr(Schema.Int)),
  t: Schema.optional(Schema.NullOr(Schema.String)),
});
const Hello = Schema.Struct({ heartbeat_interval: Schema.Number });
const Ready = Schema.Struct({
  session_id: Schema.String,
  resume_gateway_url: Schema.optional(Schema.String),
});
const Message = Schema.Struct({
  type: Schema.Literal(0),
  id: Schema.String,
  channel_id: Schema.String,
  content: Schema.String,
  author: Schema.Struct({ id: Schema.String, username: Schema.String }),
  guild_id: Schema.optional(Schema.String),
  member: Schema.optional(
    Schema.Struct({
      nick: Schema.optional(Schema.NullOr(Schema.String)),
      roles: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

export const decodeMessage = (input: unknown): MessageReceived | undefined => {
  const decoded = Schema.decodeUnknownOption(Message)(input);
  if (Option.isNone(decoded)) return;
  const value = decoded.value;
  return new MessageReceived({
    message: value.content,
    messageID: value.id,
    channelId: value.channel_id,
    username: value.author.username,
    userId: value.author.id,
    nickname: value.member?.nick ?? "",
    guildId: value.guild_id ?? "",
    rolesJson: JSON.stringify(value.member?.roles ?? []),
    payloadJson: JSON.stringify(input),
  });
};

export const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
export const MAX_RECONNECTS = 5;
export const RECONNECT_DELAY = 5000;

const resumeUrl = (input: string | undefined) => {
  if (!input) return GATEWAY_URL;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "wss:" ||
      !(
        url.hostname === "gateway.discord.gg" ||
        /^gateway-[a-z0-9-]+\.discord\.gg$/.test(url.hostname)
      ) ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return GATEWAY_URL;
    url.search = "?v=10&encoding=json";
    return url.href;
  } catch {
    return GATEWAY_URL;
  }
};

type IdentifyCooldown = { next: number; readonly now: () => number };

/** Each start owns its socket and timers; IDENTIFY cooldown belongs to the service. */
function startGateway(
  options: GatewayOptions,
  makeSocket: (url: string) => GatewaySocket,
  cooldown: IdentifyCooldown,
): () => void {
  let stopped = false;
  let socket: GatewaySocket | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let identifyTimer: ReturnType<typeof setTimeout> | undefined;
  let sequence: number | null = null;
  let sessionId: string | undefined;
  let sessionUrl = GATEWAY_URL;
  let attempts = 0;

  const disposeSocket = (code: number) => {
    clearTimeout(heartbeat);
    clearTimeout(timeout);
    clearTimeout(identifyTimer);
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(code);
      } catch {
        /* Closing an already failed socket is harmless. */
      }
      socket = undefined;
    }
  };

  const retry = (code = 0) => {
    if (stopped) return;
    // Normal close codes invalidate Discord sessions, preventing RESUME.
    disposeSocket(4000);
    clearTimeout(reconnect);
    if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) {
      stopped = true;
      options.onStatus(
        "error",
        code === 4013 || code === 4014 ? "intents-rejected" : "authentication-failed",
      );
      return;
    }
    if ([1000, 1001, 4007, 4009].includes(code)) {
      sessionId = undefined;
      sequence = null;
    }
    if (attempts >= MAX_RECONNECTS) {
      stopped = true;
      options.onStatus("error", "reconnect-exhausted");
      return;
    }
    options.onStatus("connecting");
    // Keep new IDENTIFY attempts at least five seconds apart (Discord's session limit).
    reconnect = setTimeout(connect, Math.min(RECONNECT_DELAY * 2 ** attempts++, 30000));
  };

  const connect = () => {
    if (stopped) return;
    options.onStatus("connecting");
    let current: GatewaySocket;
    try {
      current = makeSocket(sessionId && sequence !== null ? sessionUrl : GATEWAY_URL);
    } catch {
      retry();
      return;
    }
    socket = current;
    let scheduledAcknowledged = true;
    let helloReceived = false;
    const send = (op: number, d: unknown) => {
      if (stopped || socket !== current) return false;
      try {
        current.send(JSON.stringify({ op, d }));
        return true;
      } catch {
        retry();
        return false;
      }
    };
    timeout = setTimeout(() => retry(), 15000);
    current.onerror = () => retry();
    current.onclose = (event) => retry(event.code);
    current.onmessage = (event) => {
      if (
        stopped ||
        socket !== current ||
        typeof event.data !== "string" ||
        event.data.length > 1024 * 1024
      )
        return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = Schema.decodeUnknownOption(Envelope)(raw);
      if (Option.isNone(parsed)) return;
      const { op, d, s, t } = parsed.value;
      if (s !== undefined && s !== null) sequence = s;
      switch (op) {
        case 10: {
          if (helloReceived) return;
          const hello = Schema.decodeUnknownOption(Hello)(d);
          if (
            Option.isNone(hello) ||
            !Number.isFinite(hello.value.heartbeat_interval) ||
            hello.value.heartbeat_interval < 100 ||
            hello.value.heartbeat_interval > 300000
          ) {
            retry();
            return;
          }
          helloReceived = true;
          const interval = hello.value.heartbeat_interval;
          const beat = () => {
            if (stopped || socket !== current) return;
            if (!scheduledAcknowledged) {
              retry();
              return;
            }
            scheduledAcknowledged = false;
            if (send(1, sequence)) heartbeat = setTimeout(beat, interval);
          };
          // Discord requires jitter before the first scheduled heartbeat.
          heartbeat = setTimeout(beat, Math.random() * interval);
          clearTimeout(timeout);
          if (sessionId && sequence !== null) {
            timeout = setTimeout(() => retry(), 15000);
            send(6, { token: options.token, session_id: sessionId, seq: sequence });
          } else {
            const identify = () => {
              if (stopped || socket !== current) return;
              const delay = Math.max(0, cooldown.next - cooldown.now());
              clearTimeout(timeout);
              timeout = setTimeout(() => retry(), delay + 15000);
              if (delay > 0) {
                identifyTimer = setTimeout(identify, delay);
                return;
              }
              if (
                send(2, {
                  token: options.token,
                  intents: (1 << 9) | (1 << 12) | (options.messageContent ? 1 << 15 : 0),
                  properties: { os: "linux", browser: "MacroGraph", device: "MacroGraph" },
                })
              )
                cooldown.next = cooldown.now() + RECONNECT_DELAY;
            };
            identify();
          }
          break;
        }
        case 11:
          scheduledAcknowledged = true;
          break;
        case 1:
          // A requested heartbeat gets no full interval before the next tick to receive its ACK.
          send(1, sequence);
          break;
        case 7:
          retry();
          break;
        case 9:
          if (typeof d !== "boolean") return;
          if (d !== true) {
            sessionId = undefined;
            sequence = null;
          }
          retry();
          break;
        case 0:
          if (!helloReceived) return;
          if (t === "READY") {
            const ready = Schema.decodeUnknownOption(Ready)(d);
            if (Option.isNone(ready)) {
              retry();
              return;
            }
            sessionId = ready.value.session_id;
            sessionUrl = resumeUrl(ready.value.resume_gateway_url);
            clearTimeout(timeout);
            options.onStatus("connected");
          } else if (t === "RESUMED") {
            clearTimeout(timeout);
            options.onStatus("connected");
          } else if (t === "MESSAGE_CREATE") {
            const message = decodeMessage(d);
            if (message) options.onMessage(message);
          }
          break;
      }
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(reconnect);
    disposeSocket(1000);
  };
}

export const makeGateway = (
  makeSocket: (url: string) => GatewaySocket,
  now: () => number = () => performance.now(),
) => {
  const cooldown: IdentifyCooldown = { next: 0, now };
  return Gateway.of({ start: (options) => startGateway(options, makeSocket, cooldown) });
};

export const gatewayLayer = Layer.sync(Gateway, () =>
  makeGateway((url) => {
    const socket = new WebSocket(url);
    const adapter: GatewaySocket = {
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data) => socket.send(data),
      close: (code) => socket.close(code),
    };
    socket.onmessage = (event) => adapter.onmessage?.(event);
    socket.onclose = (event) => adapter.onclose?.(event);
    socket.onerror = () => adapter.onerror?.();
    return adapter;
  }),
);
