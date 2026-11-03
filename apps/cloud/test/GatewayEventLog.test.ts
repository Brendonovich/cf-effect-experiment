import { describe, it, assert } from "@effect/vitest";
import { Delivery } from "@macrograph/gateway";
import { DatabaseSync } from "node:sqlite";

import { EventLog } from "../src/gateway/EventLog.ts";

const sqlite = () => {
  const database = new DatabaseSync(":memory:");
  return {
    exec: (query: string, ...bindings: ReadonlyArray<string | number | null>) => {
      const rows = database.prepare(query).all(...bindings);
      return { toArray: () => rows as ReadonlyArray<Record<string, unknown>> };
    },
  };
};

const setup = () => {
  let time = Date.parse("2026-11-01T00:00:00Z");
  const log = EventLog.make(sqlite(), () => time);
  return {
    log,
    advance: (ms: number) => {
      time += ms;
    },
  };
};

const follow = (id: string) =>
  ({ id, source: "twitch", account: "1234", type: "channel.follow", data: { user: id } }) as const;

describe("Gateway event log", () => {
  it("numbers events in order and ignores redelivered ones", () => {
    const { log } = setup();
    const first = log.append(follow("a"));
    const second = log.append(follow("b"));
    assert.strictEqual(first?.seq, 1);
    assert.strictEqual(second?.seq, 2);
    assert.isUndefined(log.append(follow("a")));
    assert.deepStrictEqual(
      log.after(1).map((event) => event.id),
      ["b"],
    );
    assert.deepStrictEqual(log.after(0)[0]?.data, { user: "a" });
    assert.deepStrictEqual(
      log.latest().map((event) => event.id),
      ["b", "a"],
    );
  });

  it("queues matching events for each webhook and retries with backoff", () => {
    const { log, advance } = setup();
    const all = log.addWebhook({ url: "https://example.com/all", events: [] });
    log.addWebhook({ url: "https://example.com/github", events: ["github.*"] });
    assert.match(all.secret, /^mgws_/);

    log.append(follow("a"));
    const due = log.due();
    assert.lengthOf(due, 1);
    assert.strictEqual(due[0]?.webhook.id, all.id);

    log.recordAttempt(due[0]!.delivery, { status: 500, error: "HTTP 500" });
    assert.lengthOf(log.due(), 0);
    assert.strictEqual(log.nextDueAt(), Date.parse("2026-11-01T00:00:00Z") + 10_000);
    advance(10_000);
    const retry = log.due();
    assert.strictEqual(retry[0]?.delivery.attempts, 1);
    log.recordAttempt(retry[0]!.delivery, { status: 204, error: null });
    assert.isUndefined(log.nextDueAt());
    assert.strictEqual(log.deliveries(all.id)[0]?.status, "delivered");
  });

  it("gives up after the last retry", () => {
    const { log, advance } = setup();
    log.addWebhook({ url: "https://example.com/all", events: [] });
    log.append(follow("a"));
    for (let attempt = 0; attempt <= Delivery.retryDelaysSeconds.length; attempt++) {
      const [next] = log.due();
      assert.isDefined(next);
      log.recordAttempt(next!.delivery, { status: null, error: "unreachable" });
      advance(24 * 60 * 60 * 1000);
    }
    assert.lengthOf(log.due(), 0);
    assert.strictEqual(log.deliveries()[0]?.status, "failed");
  });

  it("removes a webhook with its queued deliveries", () => {
    const { log } = setup();
    const webhook = log.addWebhook({ url: "https://example.com/all", events: [] });
    log.append(follow("a"));
    assert.isTrue(log.removeWebhook(webhook.id));
    assert.isFalse(log.removeWebhook(webhook.id));
    assert.lengthOf(log.due(), 0);
  });

  it("prunes events past retention", () => {
    const { log, advance } = setup();
    log.append(follow("old"));
    advance(EventLog.retentionMs + 1);
    log.append(follow("new"));
    log.prune();
    assert.deepStrictEqual(
      log.after(0).map((event) => event.id),
      ["new"],
    );
  });

  it("signs deliveries with the webhook's secret", async () => {
    const { log } = setup();
    const webhook = log.addWebhook({ url: "https://example.com/all", events: [] });
    const event = log.append(follow("a"))!;
    let received: { url: string; init: RequestInit } | undefined;
    const outcome = await EventLog.deliver({ webhook, event }, async (url, init) => {
      received = { url: String(url), init: init ?? {} };
      return new Response(null, { status: 204 });
    });
    assert.deepStrictEqual(outcome, { status: 204, error: null });
    const headers = new Headers(received?.init.headers);
    const body = String(received?.init.body);
    assert.strictEqual(headers.get("macrograph-event-type"), "twitch.channel.follow");
    assert.isTrue(
      await Delivery.verify(webhook.secret, headers.get(Delivery.signatureHeader) ?? "", body),
    );
    assert.deepStrictEqual(JSON.parse(body).data, { user: "a" });
  });
});
