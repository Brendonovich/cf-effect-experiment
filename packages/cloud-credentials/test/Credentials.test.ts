import { assert, it as effectIt } from "@effect/vitest";
import { Deferred, Effect, Fiber, Redacted } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
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
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("MacroGraph cloud credentials", () => {
  it("registers, caches, refreshes, redacts, notifies, and expires authorization", async () => {
    const store = new MemoryStore();
    let now = 1_000;
    let poll = 0;
    let token = "twitch-access-1";
    let credentialGets = 0;
    let devicePolls = 0;
    const respond = vi.fn<(request: HttpClientRequest.HttpClientRequest) => Response>((request) => {
      const url = request.url;
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
      if (url.endsWith("/server/registration") && request.method === "POST") {
        expect(request.headers["content-type"]).toBe("application/json");
        expect(request.body._tag).toBe("Uint8Array");
        if (request.body._tag === "Uint8Array")
          expect(JSON.parse(new TextDecoder().decode(request.body.body))).toEqual({
            id: "registration-1",
          });
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
    const service = Effect.runSync(
      CloudCredentials.make({ store, now: () => now }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
          ),
        ),
      ),
    );
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
    const deviceStart = respond.mock.calls.find(([request]) =>
      request.url.endsWith("/login/device/code"),
    );
    expect(deviceStart?.[0].headers.authorization).toBe("Bearer macrograph-session-secret");

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
    for (const [request] of respond.mock.calls.filter(([request]) =>
      request.url.includes("/credentials"),
    )) {
      expect(request.url).not.toContain("macrograph-session-secret");
      expect(request.headers["client-id"]).toBe("macrograph-server");
      expect(request.headers.authorization).toBe("Bearer macrograph-session-secret");
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
    const service = Effect.runSync(
      CloudCredentials.make({ store }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                json({
                  id: "registration-1",
                  userCode: "ABCD",
                  verification_uri: "https://www.macrograph.app/connect",
                  verification_uri_complete: "https://www.macrograph.app/connect?code=ABCD",
                }),
              ),
            ),
          ),
        ),
      ),
    );
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
    const service = Effect.runSync(
      CloudCredentials.make({ store }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected request")),
        ),
      ),
    );

    await expect(Effect.runPromise(service.auth.status)).rejects.toMatchObject({
      reason: "temporarily unavailable",
    });
    expect(await Effect.runPromise(service.auth.status)).toEqual({ state: "disconnected" });
    expect(reads).toBe(2);
  });

  for (const [status, body, code] of [
    [401, "not json", "authorization-expired"],
    [403, "not json", "request-failed"],
    [500, "not json", "request-failed"],
    [200, "not json", "invalid-response"],
    [200, JSON.stringify({ unexpected: true }), "invalid-response"],
    [400, "not json", "invalid-response"],
    [
      400,
      JSON.stringify({ _tag: "DeviceFlowError", code: "access_denied" }),
      "authorization-denied",
    ],
  ] as const) {
    effectIt.effect(`preserves ${code} for HTTP ${status} with body ${body}`, () =>
      Effect.gen(function* () {
        let signal: AbortSignal | undefined;
        const service = yield* CloudCredentials.make({ store: new MemoryStore() }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request, _url, requestSignal) => {
              signal = requestSignal;
              return Effect.succeed(
                HttpClientResponse.fromWeb(request, new Response(body, { status })),
              );
            }),
          ),
        );
        const error = yield* Effect.flip(service.clientAuth.poll("device-1"));
        assert.strictEqual(error.code, code);
        assert.isTrue(signal?.aborted);
      }),
    );
  }

  effectIt.effect("maps transport failures without exposing their cause", () =>
    Effect.gen(function* () {
      const service = yield* CloudCredentials.make({ store: new MemoryStore() }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request, cause: "session-secret" }),
              }),
            ),
          ),
        ),
      );
      const error = yield* Effect.flip(service.clientAuth.poll("device-1"));
      assert.strictEqual(error.code, "request-failed");
      assert.notInclude(JSON.stringify(error), "session-secret");
    }),
  );

  effectIt.effect("clears stored authorization after a credential request returns 401", () =>
    Effect.gen(function* () {
      const store = new MemoryStore();
      store.value = JSON.stringify({
        state: "connected",
        token: "session-secret",
        userId: "user-1",
        email: "user@example.com",
        expiresAt: 60_000,
      });
      const service = yield* CloudCredentials.make({ store, now: () => 1_000 }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response(null, { status: 401 })),
            ),
          ),
        ),
      );
      assert.strictEqual((yield* service.credentials.catalog)._tag, "CredentialCatalogUnavailable");
      assert.isNull(store.value);
      assert.deepStrictEqual(yield* service.auth.status, { state: "disconnected" });
    }),
  );

  effectIt.effect("aborts an interrupted request", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let signal: AbortSignal | undefined;
      const service = yield* CloudCredentials.make({ store: new MemoryStore() }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((_request, _url, requestSignal) => {
            signal = requestSignal;
            return Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
          }),
        ),
      );
      const fiber = yield* service.clientAuth.poll("device-1").pipe(Effect.forkChild);
      yield* Deferred.await(started);
      assert.isFalse(signal?.aborted);
      yield* Fiber.interrupt(fiber);
      assert.isTrue(signal?.aborted);
    }),
  );

  it("captures the FetchHttpClient transport and keeps its scope open through body decoding", async () => {
    const store = new MemoryStore();
    store.value = JSON.stringify({
      state: "connected",
      token: "session-secret",
      userId: "user-1",
      email: "user@example.com",
      expiresAt: 60_000,
    });
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe("https://cloud.example/api/login/device/code");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session-secret");
      expect(new Headers(init?.headers).get("client-id")).toBe("custom-client");
      expect(new Headers(init?.headers).get("content-type")).toBeNull();
      signal = init?.signal;
      return new Response(
        new ReadableStream({
          pull(controller) {
            expect(signal?.aborted).toBe(false);
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  device_code: "device-1",
                  verification_uri_complete: "https://cloud.example/login/device?code=CODE",
                }),
              ),
            );
            controller.close();
          },
        }),
      );
    });
    const service = Effect.runSync(
      CloudCredentials.make({
        store,
        baseUrl: "https://cloud.example/api/",
        clientId: "custom-client",
        now: () => 1_000,
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    );
    expect(await Effect.runPromise(service.clientAuth.start)).toMatchObject({
      device_code: "device-1",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
  });
});
