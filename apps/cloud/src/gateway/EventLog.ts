import { Delivery, Events } from "@macrograph/gateway";

/** The part of a Durable Object's SQL storage the log uses. */
export interface Sql {
  readonly exec: (
    query: string,
    ...bindings: ReadonlyArray<string | number | null>
  ) => { readonly toArray: () => ReadonlyArray<Record<string, unknown>> };
}

export interface Webhook {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
  /** Event filter (see `Events.matches`); empty delivers everything. */
  readonly events: ReadonlyArray<string>;
  readonly createdAt: string;
}

export interface DeliveryRecord {
  readonly id: string;
  readonly webhookId: string;
  readonly eventSeq: number;
  readonly attempts: number;
  readonly status: "pending" | "delivered" | "failed";
  readonly nextAttemptAt: number | null;
  readonly lastStatus: number | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

/** Events older than this are pruned; streams and history only reach back this far. */
export const retentionMs = 7 * 24 * 60 * 60 * 1000;
const maxEvents = 10_000;
const maxPageSize = 500;

const string = (value: unknown) => (typeof value === "string" ? value : String(value ?? ""));
const number = (value: unknown) => (typeof value === "number" ? value : Number(value));
const nullableNumber = (value: unknown) =>
  value === null || value === undefined ? null : number(value);
const nullableString = (value: unknown) =>
  value === null || value === undefined ? null : string(value);

const parse = (value: unknown): unknown => {
  try {
    return JSON.parse(string(value));
  } catch {
    return null;
  }
};

const toEvent = (row: Record<string, unknown>): Events.Event => ({
  seq: number(row.seq),
  id: string(row.id),
  source: string(row.source) as Events.Source,
  account: string(row.account),
  type: string(row.type),
  receivedAt: string(row.received_at),
  data: parse(row.data),
});

const toWebhook = (row: Record<string, unknown>): Webhook => {
  const events = parse(row.events);
  return {
    id: string(row.id),
    url: string(row.url),
    secret: string(row.secret),
    events: Array.isArray(events) ? events.filter((event) => typeof event === "string") : [],
    createdAt: string(row.created_at),
  };
};

const toDelivery = (row: Record<string, unknown>): DeliveryRecord => ({
  id: string(row.id),
  webhookId: string(row.webhook_id),
  eventSeq: number(row.event_seq),
  attempts: number(row.attempts),
  status: string(row.status) as DeliveryRecord["status"],
  nextAttemptAt: nullableNumber(row.next_attempt_at),
  lastStatus: nullableNumber(row.last_status),
  lastError: nullableString(row.last_error),
  updatedAt: string(row.updated_at),
});

/**
 * One user's gateway events, outbound webhooks, and their delivery queue, kept in the user's
 * Durable Object SQLite database.
 */
export const make = (sql: Sql, now: () => number = Date.now) => {
  sql.exec(`CREATE TABLE IF NOT EXISTS gateway_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    account TEXT NOT NULL,
    type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    data TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS gateway_webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS gateway_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    event_seq INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    status TEXT NOT NULL,
    next_attempt_at INTEGER,
    last_status INTEGER,
    last_error TEXT,
    updated_at TEXT NOT NULL
  )`);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS gateway_deliveries_due ON gateway_deliveries (status, next_attempt_at)",
  );

  const iso = () => new Date(now()).toISOString();

  const webhooks = () =>
    sql.exec("SELECT * FROM gateway_webhooks ORDER BY created_at").toArray().map(toWebhook);

  const event = (seq: number) => {
    const row = sql.exec("SELECT * FROM gateway_events WHERE seq = ?", seq).toArray()[0];
    return row === undefined ? undefined : toEvent(row);
  };

  return {
    /**
     * Stores an event and queues it for every matching webhook. Returns `undefined` when an event
     * with the same id was already stored, so provider retries are not delivered twice.
     */
    append: (input: Omit<Events.Event, "seq" | "receivedAt">): Events.Event | undefined => {
      if (sql.exec("SELECT 1 FROM gateway_events WHERE id = ?", input.id).toArray().length > 0)
        return undefined;
      const receivedAt = iso();
      const row = sql
        .exec(
          "INSERT INTO gateway_events (id, source, account, type, received_at, data) VALUES (?, ?, ?, ?, ?, ?) RETURNING seq",
          input.id,
          input.source,
          input.account,
          input.type,
          receivedAt,
          JSON.stringify(input.data ?? null),
        )
        .toArray()[0];
      const stored: Events.Event = { ...input, seq: number(row?.seq), receivedAt };
      for (const webhook of webhooks())
        if (Events.matches(webhook.events, stored))
          sql.exec(
            "INSERT INTO gateway_deliveries (id, webhook_id, event_seq, attempts, status, next_attempt_at, updated_at) VALUES (?, ?, ?, 0, 'pending', ?, ?)",
            crypto.randomUUID(),
            webhook.id,
            stored.seq,
            now(),
            receivedAt,
          );
      return stored;
    },

    /** Events after `seq`, oldest first. */
    after: (seq: number, limit = 100) =>
      sql
        .exec(
          "SELECT * FROM gateway_events WHERE seq > ? ORDER BY seq LIMIT ?",
          seq,
          Math.max(1, Math.min(limit, maxPageSize)),
        )
        .toArray()
        .map(toEvent),

    /** The newest events, newest first. */
    latest: (limit = 50) =>
      sql
        .exec(
          "SELECT * FROM gateway_events ORDER BY seq DESC LIMIT ?",
          Math.max(1, Math.min(limit, maxPageSize)),
        )
        .toArray()
        .map(toEvent),

    webhooks,

    addWebhook: (input: { readonly url: string; readonly events: ReadonlyArray<string> }) => {
      const webhook: Webhook = {
        id: crypto.randomUUID(),
        url: input.url,
        secret: Delivery.generateSecret(),
        events: input.events,
        createdAt: iso(),
      };
      sql.exec(
        "INSERT INTO gateway_webhooks (id, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?)",
        webhook.id,
        webhook.url,
        webhook.secret,
        JSON.stringify(webhook.events),
        webhook.createdAt,
      );
      return webhook;
    },

    removeWebhook: (id: string) => {
      sql.exec("DELETE FROM gateway_deliveries WHERE webhook_id = ?", id);
      return (
        sql.exec("DELETE FROM gateway_webhooks WHERE id = ? RETURNING id", id).toArray().length > 0
      );
    },

    /** Recent deliveries, newest first, optionally for one webhook. */
    deliveries: (webhookId?: string, limit = 50) =>
      (webhookId === undefined
        ? sql.exec("SELECT * FROM gateway_deliveries ORDER BY updated_at DESC LIMIT ?", limit)
        : sql.exec(
            "SELECT * FROM gateway_deliveries WHERE webhook_id = ? ORDER BY updated_at DESC LIMIT ?",
            webhookId,
            limit,
          )
      )
        .toArray()
        .map(toDelivery),

    /** Pending deliveries whose next attempt is due, with what to send. */
    due: () =>
      sql
        .exec(
          "SELECT * FROM gateway_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 50",
          now(),
        )
        .toArray()
        .map(toDelivery)
        .flatMap((delivery) => {
          const webhook = webhooks().find((candidate) => candidate.id === delivery.webhookId);
          const stored = event(delivery.eventSeq);
          return webhook === undefined || stored === undefined
            ? []
            : [{ delivery, webhook, event: stored }];
        }),

    /** Records an attempt, scheduling a retry with backoff or giving up after the last one. */
    recordAttempt: (
      delivery: DeliveryRecord,
      outcome: { readonly status: number | null; readonly error: string | null },
    ) => {
      const delivered = outcome.status !== null && outcome.status >= 200 && outcome.status < 300;
      const attempts = delivery.attempts + 1;
      const delay = Delivery.retryDelaysSeconds[attempts - 1];
      const status = delivered ? "delivered" : delay === undefined ? "failed" : "pending";
      sql.exec(
        "UPDATE gateway_deliveries SET attempts = ?, status = ?, next_attempt_at = ?, last_status = ?, last_error = ?, updated_at = ? WHERE id = ?",
        attempts,
        status,
        status === "pending" && delay !== undefined ? now() + delay * 1000 : null,
        outcome.status,
        outcome.error,
        iso(),
        delivery.id,
      );
    },

    /** When the next pending delivery is due, if any. */
    nextDueAt: () => {
      const row = sql
        .exec(
          "SELECT MIN(next_attempt_at) AS next FROM gateway_deliveries WHERE status = 'pending'",
        )
        .toArray()[0];
      return row === undefined || row.next === null ? undefined : number(row.next);
    },

    /** Drops events past retention or beyond the cap, and finished deliveries for them. */
    prune: () => {
      const cutoff = new Date(now() - retentionMs).toISOString();
      sql.exec("DELETE FROM gateway_events WHERE received_at < ?", cutoff);
      sql.exec(
        "DELETE FROM gateway_events WHERE seq <= (SELECT seq FROM gateway_events ORDER BY seq DESC LIMIT 1 OFFSET ?)",
        maxEvents,
      );
      sql.exec(
        "DELETE FROM gateway_deliveries WHERE status != 'pending' AND event_seq NOT IN (SELECT seq FROM gateway_events)",
      );
    },
  };
};

export type EventLog = ReturnType<typeof make>;

/** Sends one signed delivery; any non-2xx status or network error counts as a failure. */
export const deliver = async (
  target: { readonly webhook: Webhook; readonly event: Events.Event },
  fetcher: typeof fetch = fetch,
): Promise<{ readonly status: number | null; readonly error: string | null }> => {
  const body = JSON.stringify(target.event);
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const response = await fetcher(target.webhook.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "MacroGraph-Gateway",
        "macrograph-event-id": target.event.id,
        "macrograph-event-type": `${target.event.source}.${target.event.type}`,
        [Delivery.signatureHeader]: await Delivery.sign(target.webhook.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return {
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (cause) {
    return { status: null, error: cause instanceof Error ? cause.message : "Request failed" };
  }
};

export * as EventLog from "./EventLog.ts";
