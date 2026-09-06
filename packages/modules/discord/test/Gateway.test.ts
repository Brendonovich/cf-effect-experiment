import { afterEach, beforeEach, describe, it, assert, vi } from "vitest";

import {
  GATEWAY_URL,
  MAX_RECONNECTS,
  RECONNECT_DELAY,
  decodeMessage,
  makeGateway,
  type GatewayOptions,
  type GatewaySocket,
} from "../src/Gateway.ts";

class FakeSocket implements GatewaySocket {
  onmessage: GatewaySocket["onmessage"] = null;
  onclose: GatewaySocket["onclose"] = null;
  onerror: GatewaySocket["onerror"] = null;
  readonly sent: string[] = [];
  readonly close = vi.fn();
  send(data: string) {
    this.sent.push(data);
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function harness(messageContent = true) {
  const sockets: FakeSocket[] = [];
  const onStatus = vi.fn<GatewayOptions["onStatus"]>();
  const onMessage = vi.fn<GatewayOptions["onMessage"]>();
  const makeSocket = vi.fn((url: string) => {
    assert.match(url, /^wss:\/\/gateway(?:-[a-z0-9-]+)?\.discord\.gg\/\?v=10&encoding=json$/);
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const close = makeGateway(makeSocket).start({
    token: "private-token",
    messageContent,
    onStatus,
    onMessage,
  });
  return { sockets, onStatus, onMessage, close, makeSocket };
}

const message = {
  type: 0,
  id: "1",
  content: "hello",
  channel_id: "2",
  author: { id: "3", username: "test" },
};

describe("Discord v10 gateway", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("identifies with intents, heartbeats using sequence, and only connects after READY", () => {
    const h = harness();
    const socket = h.sockets[0]!;
    socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    assert.deepStrictEqual(JSON.parse(socket.sent[0]!), {
      op: 2,
      d: {
        token: "private-token",
        intents: (1 << 9) | (1 << 12) | (1 << 15),
        properties: { os: "linux", browser: "MacroGraph", device: "MacroGraph" },
      },
    });
    assert.deepStrictEqual(h.onStatus.mock.lastCall, ["connecting"]);
    socket.receive({ op: 0, t: "READY", s: 12, d: { session_id: "session" } });
    assert.deepStrictEqual(h.onStatus.mock.lastCall, ["connected"]);
    vi.advanceTimersByTime(500);
    assert.deepStrictEqual(JSON.parse(socket.sent[1]!), { op: 1, d: 12 });
    socket.receive({ op: 11 });
    socket.receive({ op: 0, t: "MESSAGE_CREATE", s: 13, d: message });
    vi.advanceTimersByTime(1000);
    assert.deepStrictEqual(JSON.parse(socket.sent[2]!), { op: 1, d: 13 });
    assert.strictEqual(h.onMessage.mock.calls.length, 1);
    h.close();
    assert.strictEqual(vi.getTimerCount(), 0);
    assert.strictEqual(socket.close.mock.calls.length, 1);
    assert.isNull(socket.onmessage);
    assert.deepStrictEqual(socket.close.mock.lastCall, [1000]);
  });

  it("clears zombie heartbeats, reconnects and resumes on the fixed gateway origin", () => {
    const h = harness(false);
    const socket = h.sockets[0]!;
    socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    assert.strictEqual(JSON.parse(socket.sent[0]!).d.intents, (1 << 9) | (1 << 12));
    socket.receive({
      op: 0,
      t: "READY",
      s: 9,
      d: { session_id: "session", resume_gateway_url: "wss://evil.example" },
    });
    vi.advanceTimersByTime(1500);
    assert.strictEqual(socket.close.mock.calls.length, 1);
    assert.deepStrictEqual(socket.close.mock.lastCall, [4000]);
    vi.advanceTimersByTime(RECONNECT_DELAY);
    const resumed = h.sockets[1]!;
    assert.strictEqual(h.makeSocket.mock.lastCall?.[0], GATEWAY_URL);
    resumed.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    assert.deepStrictEqual(JSON.parse(resumed.sent[0]!), {
      op: 6,
      d: { token: "private-token", session_id: "session", seq: 9 },
    });
    resumed.receive({ op: 0, t: "RESUMED", s: 10 });
    assert.deepStrictEqual(h.onStatus.mock.lastCall, ["connected"]);
    h.close();
    assert.strictEqual(vi.getTimerCount(), 0);
  });

  it("handles server heartbeat requests, reconnect requests and invalid sessions", () => {
    const h = harness();
    const socket = h.sockets[0]!;
    socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    socket.receive({ op: 0, t: "READY", s: 1, d: { session_id: "old-session" } });
    socket.receive({ op: 1 });
    assert.deepStrictEqual(JSON.parse(socket.sent.at(-1)!), { op: 1, d: 1 });
    socket.receive({ op: 11, d: null });
    socket.receive({ op: 9, d: false });
    vi.advanceTimersByTime(RECONNECT_DELAY);
    const next = h.sockets[1]!;
    next.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    assert.strictEqual(JSON.parse(next.sent[0]!).op, 2);
    next.receive({ op: 7, d: null });
    assert.strictEqual(next.close.mock.calls.length, 1);
    h.close();
    vi.advanceTimersByTime(60000);
    assert.strictEqual(h.sockets.length, 2);
    assert.strictEqual(vi.getTimerCount(), 0);
  });

  it("bounds retries even when a session repeatedly opens then closes", () => {
    const h = harness();
    for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
      const socket = h.sockets.at(-1)!;
      socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
      socket.receive({ op: 0, t: "READY", s: 1, d: { session_id: "session" } });
      socket.onclose?.({ code: 1006 });
      vi.advanceTimersByTime(Math.min(RECONNECT_DELAY * 2 ** attempt, 30000));
    }
    assert.strictEqual(h.sockets.length, MAX_RECONNECTS + 1);
    assert.deepStrictEqual(h.onStatus.mock.lastCall, ["error", "reconnect-exhausted"]);
    assert.strictEqual(vi.getTimerCount(), 0);
    h.close();
  });

  it("does not treat a requested heartbeat just before a scheduled tick as a zombie", () => {
    const h = harness();
    const socket = h.sockets[0]!;
    socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    socket.receive({ op: 0, t: "READY", s: 1, d: { session_id: "session" } });
    vi.advanceTimersByTime(500);
    socket.receive({ op: 11 });
    vi.advanceTimersByTime(999);
    socket.receive({ op: 1 });
    vi.advanceTimersByTime(1);
    assert.strictEqual(socket.close.mock.calls.length, 0);
    assert.strictEqual(socket.sent.length, 4);
    assert.deepStrictEqual(JSON.parse(socket.sent.at(-1)!), { op: 1, d: 1 });
    socket.receive({ op: 11 });
    vi.advanceTimersByTime(1000);
    assert.strictEqual(socket.close.mock.calls.length, 0);
    // A requested heartbeat must not hide a genuinely unacknowledged scheduled heartbeat either.
    socket.receive({ op: 1 });
    vi.advanceTimersByTime(1000);
    assert.deepStrictEqual(socket.close.mock.lastCall, [4000]);
    h.close();
    assert.strictEqual(vi.getTimerCount(), 0);
  });

  it("still validates required opcode data when envelope data is optional", () => {
    const hello = harness();
    hello.sockets[0]!.receive({ op: 10 });
    assert.deepStrictEqual(hello.sockets[0]!.close.mock.lastCall, [4000]);
    hello.close();

    const h = harness();
    const socket = h.sockets[0]!;
    socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    socket.receive({ op: 9 });
    socket.receive({ op: 9, d: "invalid" });
    socket.receive({ op: 0, t: "MESSAGE_CREATE" });
    assert.strictEqual(socket.close.mock.calls.length, 0);
    assert.strictEqual(h.onMessage.mock.calls.length, 0);
    socket.receive({ op: 0, t: "READY" });
    assert.deepStrictEqual(socket.close.mock.lastCall, [4000]);
    h.close();
    assert.strictEqual(vi.getTimerCount(), 0);
  });

  it("stops immediately on rejected authentication/intents and times out missing hello", () => {
    for (const code of [4004, 4014]) {
      const h = harness();
      h.sockets[0]!.onclose?.({ code });
      assert.deepStrictEqual(h.onStatus.mock.lastCall, [
        "error",
        code === 4014 ? "intents-rejected" : "authentication-failed",
      ]);
      assert.strictEqual(vi.getTimerCount(), 0);
      h.close();
    }
    const h = harness();
    vi.advanceTimersByTime(15000);
    assert.strictEqual(h.sockets[0]!.close.mock.calls.length, 1);
    h.close();
    assert.strictEqual(vi.getTimerCount(), 0);
  });

  it("resumes at a validated Discord gateway endpoint and rejects auth-leaking resume URLs", () => {
    for (const [resume, expected] of [
      [
        "wss://gateway-us-east1-b.discord.gg",
        "wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json",
      ],
      ["wss://gateway.discord.gg.evil.example", GATEWAY_URL],
      ["wss://user:secret@gateway.discord.gg", GATEWAY_URL],
      ["wss://gateway.discord.gg/private", GATEWAY_URL],
      ["wss://gateway.discord.gg:444", GATEWAY_URL],
    ]) {
      const h = harness();
      const socket = h.sockets[0]!;
      socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
      socket.receive({
        op: 0,
        t: "READY",
        s: 1,
        d: { session_id: "session", resume_gateway_url: resume },
      });
      socket.onclose?.({ code: 1006 });
      vi.advanceTimersByTime(RECONNECT_DELAY);
      assert.strictEqual(h.makeSocket.mock.lastCall?.[0], expected);
      h.close();
      assert.strictEqual(vi.getTimerCount(), 0);
    }
  });

  it("ignores malformed JSON, non-normal messages and supports DMs without member data", () => {
    const h = harness();
    const socket = h.sockets[0]!;
    socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    socket.onmessage?.({ data: "not json" });
    socket.receive({ op: 0, t: "MESSAGE_CREATE", d: { ...message, type: 7 } });
    socket.receive({ op: 0, t: "MESSAGE_CREATE", d: { content: "missing required fields" } });
    socket.receive({ op: 0, t: "MESSAGE_UPDATE", d: message });
    assert.strictEqual(h.onMessage.mock.calls.length, 0);
    const decoded = decodeMessage(message)!;
    assert.strictEqual(decoded.guildId, "");
    assert.strictEqual(decoded.nickname, "");
    assert.strictEqual(decoded.rolesJson, "[]");
    assert.deepStrictEqual(JSON.parse(decoded.payloadJson), message);
    h.close();
  });
});
