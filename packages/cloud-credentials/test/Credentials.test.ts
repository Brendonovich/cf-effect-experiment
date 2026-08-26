import { Effect, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";

import { CloudCredentials, SessionStoreError } from "../src/index.ts";

class MemoryStore implements CloudCredentials.SessionStore {
  value: string | null = null;
  read = Effect.sync(() => this.value);
  write = (value: string) =>
    Effect.sync(() => {
      this.value = value;
    });
  clear = Effect.sync(() => {
    this.value = null;
  });
}

const json = (value: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

describe("MacroGraph cloud credentials", () => {
  it("registers, caches, refreshes, redacts, notifies, and expires authorization", async () => {
    const store = new MemoryStore();
    let now = 1_000;
    let poll = 0;
    let token = "twitch-access-1";
    let credentialGets = 0;
    let devicePolls = 0;
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = String(input);
      if (url.endsWith("/login/device/code"))
        return json({
          device_code: "device-1",
          verification_uri_complete: "https://www.macrograph.app/login/device?code=ABCD",
        });
      if (url.includes("/login/oauth/access_token")) {
        devicePolls++;
        return devicePolls === 1
          ? json({ _tag: "DeviceFlowError", code: "authorization_pending" }, 400)
          : json({
              userId: "user-1",
              access_token: "user-access-token",
              refresh_token: "user-refresh-token",
              token_type: "Bearer",
            });
      }
      if (url.endsWith("/server/registration/start"))
        return json({
          id: "registration-1",
          userCode: "ABCD",
          verification_uri: "https://www.macrograph.app/connect",
          verification_uri_complete: "https://www.macrograph.app/connect?code=ABCD",
        });
      if (url.endsWith("/server/registration") && init?.method === "POST") {
        poll++;
        return poll === 1
          ? json({ _tag: "ServerRegistrationError", code: "authorization_pending" }, 400)
          : json({ token: "macrograph-session-secret" });
      }
      if (url.endsWith("/server/registration")) return json({ ownerId: "user-1" });
      if (url.endsWith("/user")) return json({ id: "user-1", email: "user@example.com" });
      if (url.includes("/refresh")) {
        token = "twitch-access-2";
        return json(credential());
      }
      credentialGets++;
      return json([credential()]);
    });
    const credential = () => ({
      provider: "twitch",
      id: "account/1",
      displayName: "Streamer",
      scopes: ["chat:read"],
      metadata: {
        clientId: "custom-client",
        nested: { token, note: `contains ${token}`, password: "metadata-secret" },
      },
      token: {
        access_token: token,
        refresh_token: "twitch-refresh-secret",
        expires_in: 3600,
        token_type: "bearer",
        issuedAt: 1,
      },
    });
    const service = CloudCredentials.make({ store, fetch, now: () => now });
    expect(CloudCredentials.normalizeBaseUrl("https://macrograph.app/api/")).toBe(
      CloudCredentials.DEFAULT_BASE_URL,
    );
    expect(await Effect.runPromise(service.auth.start)).toMatchObject({ state: "pending" });
    expect(await Effect.runPromise(service.auth.poll)).toMatchObject({ state: "pending" });
    expect(await Effect.runPromise(service.auth.poll)).toEqual({
      state: "connected",
      identity: { id: "user-1", displayName: "user@example.com" },
    });
    expect(JSON.stringify(await Effect.runPromise(service.auth.status))).not.toContain(
      "macrograph-session-secret",
    );
    const device = await Effect.runPromise(service.clientAuth.start);
    expect(device.device_code).toBe("device-1");
    expect(await Effect.runPromise(service.clientAuth.poll(device.device_code))).toEqual({
      state: "pending",
    });
    expect(await Effect.runPromise(service.clientAuth.poll(device.device_code))).toEqual({
      state: "connected",
      userId: "user-1",
      email: "user@example.com",
    });
    const deviceStart = fetch.mock.calls.find(([input]) =>
      String(input).endsWith("/login/device/code"),
    );
    expect(new Headers(deviceStart?.[1]?.headers).get("authorization")).toBe(
      "Bearer macrograph-session-secret",
    );

    let notifications = 0;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* service.credentials.subscribe(() => Effect.sync(() => notifications++));
          const values = yield* Effect.all(
            [service.credentials.get, service.credentials.get, service.credentials.get],
            { concurrency: "unbounded" },
          );
          expect(values[0]?.[0]?.clientId).toBe("custom-client");
          expect(Redacted.value(values[0]![0]!.token.access)).toBe("twitch-access-1");
          const catalog = yield* service.credentials.catalog;
          expect(JSON.stringify(catalog)).not.toContain("twitch-access");
          expect(JSON.stringify(catalog)).not.toContain("twitch-refresh-secret");
          expect(JSON.stringify(catalog)).not.toContain("metadata-secret");
          const refreshed = yield* service.credentials.refresh("twitch", "account/1");
          expect(Redacted.value(refreshed.token.access)).toBe("twitch-access-2");
          yield* service.credentials.refetch;
        }),
      ),
    );
    expect(credentialGets).toBe(3);
    expect(notifications).toBe(2);
    for (const [input, init] of fetch.mock.calls.filter(([input]) =>
      String(input).includes("/credentials"),
    )) {
      expect(String(input)).not.toContain("macrograph-session-secret");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer macrograph-session-secret",
      );
    }

    now += CloudCredentials.SESSION_LIFETIME_MS + 1;
    expect(await Effect.runPromise(service.auth.status)).toEqual({ state: "disconnected" });
    expect(store.value).toBeNull();
    expect(await Effect.runPromise(service.credentials.catalog)).toMatchObject({
      _tag: "CredentialCatalogUnavailable",
    });
  });

  it("does not retain pending state when durable storage fails", async () => {
    const store: CloudCredentials.SessionStore = {
      read: Effect.succeed(null),
      write: () => Effect.fail(new SessionStoreError({ reason: "disk full" })),
      clear: Effect.void,
    };
    const service = CloudCredentials.make({
      store,
      fetch: vi.fn<typeof globalThis.fetch>(() =>
        json({
          id: "registration-1",
          userCode: "ABCD",
          verification_uri: "https://www.macrograph.app/connect",
          verification_uri_complete: "https://www.macrograph.app/connect?code=ABCD",
        }),
      ),
    });
    await expect(Effect.runPromise(service.auth.start)).rejects.toMatchObject({
      reason: "disk full",
    });
    expect(await Effect.runPromise(service.auth.status)).toEqual({ state: "disconnected" });
  });

  it("retries session loading after a transient durable storage failure", async () => {
    let reads = 0;
    const store: CloudCredentials.SessionStore = {
      read: Effect.suspend(() =>
        ++reads === 1
          ? Effect.fail(new SessionStoreError({ reason: "temporarily unavailable" }))
          : Effect.succeed(null),
      ),
      write: () => Effect.void,
      clear: Effect.void,
    };
    const service = CloudCredentials.make({ store, fetch: vi.fn() });

    await expect(Effect.runPromise(service.auth.status)).rejects.toMatchObject({
      reason: "temporarily unavailable",
    });
    expect(await Effect.runPromise(service.auth.status)).toEqual({ state: "disconnected" });
    expect(reads).toBe(2);
  });
});
