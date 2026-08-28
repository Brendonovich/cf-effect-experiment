import { assert, describe, it, vi } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

import { eventKinds, type TikTokEvent } from "../src/Definition.ts";
import { decodeEvent } from "../src/Events.ts";
import { createManagedClient, type ManagedSocket } from "../src/Managed.ts";

class FakeSocket extends EventEmitter implements ManagedSocket {
  readyState = 0;
  readonly terminate = vi.fn(() => {
    this.readyState = 3;
    this.emit("close", 1006);
  });
  message(value: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }
  close(code: number) {
    this.readyState = 3;
    this.emit("close", code);
  }
}

function harness(apiKey = "private+/key") {
  const socket = new FakeSocket();
  const factory = vi.fn((_url: string) => socket);
  const client = createManagedClient({ username: "creator", apiKey }, factory);
  const events: TikTokEvent[] = [];
  const errors: unknown[] = [];
  const states: Array<readonly [string, unknown]> = [];
  for (const kind of eventKinds) {
    if (kind === "giftStreak") continue;
    client.on(kind, (payload) => {
      const event = decodeEvent(kind, payload);
      if (event) events.push(event);
    });
  }
  client.on("error", (error) => errors.push(error));
  for (const kind of ["connected", "connecting", "roomInfo", "disconnected"] as const)
    client.on(kind, (payload) => states.push([kind, payload]));
  return { socket, factory, client, events, errors, states };
}

describe("managed Euler WebSocket protocol", () => {
  it("is inert until connect and routes the Electron service's single/batched payloads", async () => {
    const h = harness();
    assert.strictEqual(h.factory.mock.calls.length, 0);
    const ready = h.client.connect();
    const url = new URL(h.factory.mock.calls[0]![0]);
    assert.strictEqual(url.origin, "wss://ws.eulerstream.com");
    assert.strictEqual(url.searchParams.get("uniqueId"), "creator");
    assert.strictEqual(url.searchParams.get("apiKey"), "private+/key");
    h.socket.emit("open");
    assert.strictEqual(h.states.length, 0);
    h.socket.message({ type: "roomInfo", data: { roomId: 123 } });
    assert.deepStrictEqual(h.states, [["roomInfo", { roomId: "123" }]]);
    h.socket.message({
      messages: [
        { type: "room.status", data: { state: "connected", roomId: "123" } },
        { type: "WebcastChatMessage", data: { uniqueId: "chatter", comment: "hi" } },
        {
          type: "WebcastGiftMessage",
          data: {
            user: { uniqueId: "gifter" },
            giftType: 1,
            repeatEnd: false,
            repeatCount: 2,
            extendedGiftInfo: { name: "Rose", diamondCount: 1 },
          },
        },
        {
          type: "WebcastGiftMessage",
          data: {
            uniqueId: "gifter",
            giftType: 1,
            repeatEnd: true,
            repeatCount: 3,
            gift: { gift_name: "Rose", diamond_count: 1 },
          },
        },
        { type: "WebcastMemberMessage", data: { uniqueId: "member" } },
        { type: "WebcastSocialMessage", data: { uniqueId: "follower", shareType: null } },
        { type: "WebcastSocialMessage", data: { uniqueId: "sharer", shareType: 0 } },
        { type: "WebcastLikeMessage", data: { uniqueId: "liker", likeCount: 5 } },
        { type: "unknownProviderEvent", data: {} },
      ],
    });
    assert.isUndefined(await ready);
    assert.deepStrictEqual(
      h.events.map((event) => event.kind),
      ["chat", "giftStreak", "gift", "member", "follow", "share", "like"],
    );
    assert.strictEqual(h.events[0]!.comment, "hi");
    assert.strictEqual(h.events[2]!.giftName, "Rose");
    assert.strictEqual(h.events[2]!.repeatCount, 3);
    assert.strictEqual(h.events[2]!.diamonds, 1);
    assert.strictEqual(h.events[6]!.likeCount, 5);
    assert.strictEqual(h.errors.length, 0);
    await h.client.disconnect();
    assert.strictEqual(h.socket.eventNames().length, 0);
  });

  it("tracks provider reconnecting states without mistaking socket-open or roomInfo for room-ready", async () => {
    const h = harness();
    const ready = h.client.connect();
    h.socket.message({
      messages: [
        { type: "room.status", data: { state: "connecting" } },
        { type: "tiktok.connect", data: {} },
        { type: "room.status", data: { state: "reconnecting", roomId: "next" } },
      ],
    });
    assert.isUndefined(await ready);
    assert.deepStrictEqual(
      h.states.map(([state]) => state),
      ["connecting", "connected", "connecting"],
    );
    h.socket.message({ type: "room.status", data: { state: "connected", roomId: "next" } });
    h.socket.message({ type: "tiktok.disconnect", data: {} });
    assert.strictEqual(h.states.at(-1)![0], "disconnected");
    assert.strictEqual(h.socket.terminate.mock.calls.length, 1);
    assert.strictEqual(h.socket.eventNames().length, 0);
  });

  it("aborts pending handshakes, clears listeners and rejects late messages after disconnect", async () => {
    const h = harness();
    const ready = h.client.connect();
    const stale = h.socket.listeners("message")[0]!;
    await h.client.disconnect();
    assert.isUndefined(await ready);
    stale(Buffer.from(JSON.stringify({ type: "tiktok.connect", data: {} })));
    assert.strictEqual(h.states.length, 0);
    assert.strictEqual(h.socket.eventNames().length, 0);
    await h.client.disconnect();
    assert.strictEqual(h.socket.terminate.mock.calls.length, 1);
  });

  it("maps actual provider close codes to sanitized errors and distinguishes normal termination", async () => {
    for (const [code, reason] of [
      [4404, "creator-offline"],
      [4401, "authentication-failed"],
      [4403, "authentication-failed"],
      [4556, "provider-failed"],
      [1011, "provider-failed"],
      [1006, "connection-failed"],
    ] as const) {
      const h = harness();
      const ready = h.client.connect();
      h.socket.close(code);
      await ready;
      assert.deepStrictEqual(h.errors, [{ reason }]);
      assert.isFalse(JSON.stringify(h.errors).includes("private"));
      assert.strictEqual(h.socket.eventNames().length, 0);
    }
    for (const code of [1000, 4005]) {
      const h = harness();
      const ready = h.client.connect();
      h.socket.close(code);
      await ready;
      assert.strictEqual(h.errors.length, 0);
      assert.strictEqual(h.states[0]![0], "disconnected");
    }
  });

  it("handles room offline/ended/error and network errors without forwarding provider messages", async () => {
    for (const state of ["offline", "ended", "error"]) {
      const h = harness();
      const ready = h.client.connect();
      h.socket.message({
        type: "room.status",
        data: { state, message: "private+/key in provider URL" },
      });
      await ready;
      assert.strictEqual(h.socket.eventNames().length, 0);
      assert.isFalse(JSON.stringify(h.errors).includes("private"));
      if (state === "error") assert.deepStrictEqual(h.errors, [{ reason: "provider-failed" }]);
      else assert.strictEqual(h.states[0]![0], "disconnected");
    }
    const h = harness();
    const ready = h.client.connect();
    h.socket.emit("error", new Error("private+/key"));
    await ready;
    assert.deepStrictEqual(h.errors, [{ reason: "connection-failed" }]);
  });

  it("rejects invalid envelopes/control payloads and requires a managed key before creating a socket", async () => {
    const missing = harness("");
    await missing.client.connect();
    assert.strictEqual(missing.factory.mock.calls.length, 0);
    assert.deepStrictEqual(missing.errors, [{ reason: "authentication-failed" }]);
    for (const input of [
      null,
      [],
      { messages: "bad" },
      { type: "roomInfo", data: { roomId: {} } },
      { type: "room.status", data: { state: 2 } },
      { messages: [{ type: "chat" }] },
    ]) {
      const h = harness();
      const ready = h.client.connect();
      h.socket.message(input);
      await ready;
      assert.deepStrictEqual(h.errors, [{ reason: "invalid-payload" }]);
      assert.strictEqual(h.socket.eventNames().length, 0);
    }
    const h = harness();
    const ready = h.client.connect();
    h.socket.emit("message", Buffer.from("not json"));
    await ready;
    assert.deepStrictEqual(h.errors, [{ reason: "invalid-payload" }]);
  });

  it("bounds room readiness and cancels its timer on disposal", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const ready = h.client.connect();
      await vi.advanceTimersByTimeAsync(30000);
      await ready;
      assert.deepStrictEqual(h.errors, [{ reason: "connection-failed" }]);
      assert.strictEqual(h.socket.eventNames().length, 0);
      assert.strictEqual(vi.getTimerCount(), 0);
      const second = harness();
      const pending = second.client.connect();
      await second.client.disconnect();
      await pending;
      assert.strictEqual(vi.getTimerCount(), 0);
    } finally {
      vi.useRealTimers();
    }
  });
});
