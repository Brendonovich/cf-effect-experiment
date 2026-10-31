import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { describe, expect, vi } from "vitest";

import { CloudCredentials, SessionStoreError } from "../src/index.ts";

const issuer = "https://auth.example";
const playground = { type: "public", clientId: "macrograph-playground" } as const;

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
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const metadata = {
  issuer,
  device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
  token_endpoint: `${issuer}/oauth/token`,
  jwks_uri: `${issuer}/oauth/jwks`,
  revocation_endpoint: `${issuer}/oauth/revoke`,
};

const deviceAuthorization = {
  device_code: "device-1",
  user_code: "BCDF-GHJK",
  verification_uri: `${issuer}/device`,
  verification_uri_complete: `${issuer}/device?user_code=BCDF-GHJK`,
  expires_in: 600,
  interval: 5,
};

const base64Url = (value: Uint8Array | string) =>
  btoa(typeof value === "string" ? value : String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const signingKey = Effect.promise(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const sign = async (claims: Record<string, unknown>) => {
    const input = `${base64Url(JSON.stringify({ alg: "RS256", kid: "key-1" }))}.${base64Url(JSON.stringify(claims))}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(input),
    );
    return `${input}.${base64Url(new Uint8Array(signature))}`;
  };
  return { jwks: { keys: [{ kty: "RSA", kid: "key-1", n: jwk.n, e: jwk.e }] }, sign };
});

/** A minimal authorization server; `token` answers the token endpoint. */
const fakeServer = (routes: {
  readonly metadata?: unknown;
  readonly device?: unknown;
  readonly jwks?: unknown;
  readonly token?: () => Promise<Response> | Response;
}) =>
  HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
    Effect.promise(async () => {
      const path = new URL(request.url).pathname;
      const response =
        path === "/.well-known/oauth-authorization-server"
          ? json(routes.metadata ?? metadata)
          : path === "/oauth/device_authorization"
            ? json(routes.device ?? deviceAuthorization)
            : path === "/oauth/jwks"
              ? json(routes.jwks ?? { keys: [] })
              : path === "/oauth/token" && routes.token !== undefined
                ? await routes.token()
                : path === "/oauth/revoke"
                  ? new Response(null, { status: 200 })
                  : json({ error: "not_found" }, 404);
      return HttpClientResponse.fromWeb(request, response);
    }),
  );

const make = (client: HttpClient.HttpClient, options: Partial<CloudCredentials.Options> = {}) =>
  CloudCredentials.make({
    store: new MemoryStore(),
    issuer,
    client: playground,
    ...options,
  }).pipe(Effect.provideService(HttpClient.HttpClient, client));

describe("MacroGraph OAuth client", () => {
  it.effect("does not retain a pending authorization when durable storage fails", () =>
    Effect.gen(function* () {
      const store: CloudCredentials.SessionStore = {
        read: Effect.succeed(null),
        write: () => Effect.fail(new SessionStoreError({ reason: "disk full" })),
        clear: Effect.void,
      };
      const service = yield* make(fakeServer({}), { store });
      const error = yield* Effect.flip(service.auth.start);
      assert.strictEqual(error.reason, "disk full");
      assert.deepStrictEqual(yield* service.auth.status, { state: "disconnected" });
    }),
  );

  it.effect("retries loading after a transient storage failure", () =>
    Effect.gen(function* () {
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
      const service = yield* make(fakeServer({}), { store });
      assert.strictEqual(
        (yield* Effect.flip(service.auth.status)).reason,
        "temporarily unavailable",
      );
      assert.deepStrictEqual(yield* service.auth.status, { state: "disconnected" });
      assert.strictEqual(reads, 2);
    }),
  );

  it.effect("discards state saved by older versions", () =>
    Effect.gen(function* () {
      const store = new MemoryStore();
      store.value = JSON.stringify({
        state: "connected",
        token: "legacy-server-jwt",
        userId: "user-1",
        email: "user@example.com",
        expiresAt: Number.MAX_SAFE_INTEGER,
      });
      const service = yield* make(fakeServer({}), { store });
      assert.deepStrictEqual(yield* service.auth.status, { state: "disconnected" });
      assert.isNull(store.value);
    }),
  );

  it.effect("rejects metadata published for a different issuer (RFC 8414 §3.3)", () =>
    Effect.gen(function* () {
      const service = yield* make(
        fakeServer({ metadata: { ...metadata, issuer: "https://attacker.example" } }),
      );
      assert.strictEqual((yield* Effect.flip(service.signIn.start)).code, "invalid-response");
    }),
  );

  it.effect("rejects unsafe verification URLs", () =>
    Effect.gen(function* () {
      const service = yield* make(
        fakeServer({
          device: { ...deviceAuthorization, verification_uri_complete: "javascript:alert(1)" },
        }),
      );
      const error = yield* Effect.flip(service.signIn.start);
      assert.strictEqual(error.reason, "MacroGraph returned an unsafe verification URL");
    }),
  );

  it.effect("waits out the polling interval and backs off on slow_down", () =>
    Effect.gen(function* () {
      let now = 0;
      let requests = 0;
      const service = yield* make(
        fakeServer({
          token: () => {
            requests++;
            return json({ error: "slow_down" }, 400);
          },
        }),
        { now: () => now },
      );
      const started = yield* service.signIn.start;
      assert.deepStrictEqual(yield* service.signIn.poll(started.deviceCode), {
        state: "pending",
        interval: 5,
      });
      assert.strictEqual(requests, 0);
      now = 5_000;
      assert.deepStrictEqual(yield* service.signIn.poll(started.deviceCode), {
        state: "pending",
        interval: 10,
      });
      now = 14_000;
      yield* service.signIn.poll(started.deviceCode);
      assert.strictEqual(requests, 1);
    }),
  );

  for (const [name, change] of [
    ["a different audience", { aud: "someone-else" }],
    ["a different issuer", { iss: "https://attacker.example" }],
    ["an expired token", { exp: 100 }],
    ["a token issued in the future", { iat: 10_000 }],
    ["several audiences without azp", { aud: ["macrograph-playground", "other"] }],
  ] as const)
    it.effect(`rejects ID tokens with ${name} (OpenID Connect Core §3.1.3.7)`, () =>
      Effect.gen(function* () {
        const key = yield* signingKey;
        let now = 1_000_000;
        const claims = {
          iss: issuer,
          sub: "user-1",
          aud: "macrograph-playground",
          iat: now / 1000,
          exp: now / 1000 + 300,
          email: "user@example.com",
          ...change,
        };
        const service = yield* make(
          fakeServer({
            jwks: key.jwks,
            token: async () =>
              json({ access_token: "a", token_type: "Bearer", id_token: await key.sign(claims) }),
          }),
          { now: () => now },
        );
        const started = yield* service.signIn.start;
        now += 5_000;
        const error = yield* Effect.flip(service.signIn.poll(started.deviceCode));
        assert.strictEqual(error.reason, "MacroGraph returned an invalid ID token");
      }),
    );

  it.effect("accepts a valid ID token and rejects a forged signature", () =>
    Effect.gen(function* () {
      const key = yield* signingKey;
      let now = 1_000_000;
      let forged = false;
      const service = yield* make(
        fakeServer({
          jwks: key.jwks,
          token: async () => {
            const token = await key.sign({
              iss: issuer,
              sub: "user-1",
              aud: "macrograph-playground",
              iat: now / 1000,
              exp: now / 1000 + 300,
              email: "user@example.com",
            });
            const [header, , signature] = token.split(".");
            return json({
              access_token: "a",
              token_type: "Bearer",
              id_token: forged
                ? `${header}.${base64Url(JSON.stringify({ sub: "admin" }))}.${signature}`
                : token,
            });
          },
        }),
        { now: () => now },
      );
      const started = yield* service.signIn.start;
      now += 5_000;
      assert.deepStrictEqual(yield* service.signIn.poll(started.deviceCode), {
        state: "connected",
        userId: "user-1",
        email: "user@example.com",
      });

      forged = true;
      const again = yield* service.signIn.start;
      now += 5_000;
      assert.strictEqual(
        (yield* Effect.flip(service.signIn.poll(again.deviceCode))).code,
        "invalid-response",
      );
    }),
  );

  it.effect("keeps the fetch transport's scope open through body decoding", () =>
    Effect.gen(function* () {
      const signals: Array<AbortSignal | null | undefined> = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const path = new URL(String(input)).pathname;
        const signal = init?.signal;
        signals.push(signal);
        if (path === "/oauth/device_authorization") {
          expect(init?.method).toBe("POST");
          expect(new Headers(init?.headers).get("content-type")).toBe(
            "application/x-www-form-urlencoded",
          );
          expect(String(init?.body)).toBe("scope=openid+email&client_id=macrograph-playground");
        }
        const body = path === "/oauth/device_authorization" ? deviceAuthorization : metadata;
        return new Response(
          new ReadableStream({
            pull(controller) {
              expect(signal?.aborted).toBe(false);
              controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
              controller.close();
            },
          }),
        );
      });
      const service = yield* CloudCredentials.make({
        store: new MemoryStore(),
        issuer,
        client: playground,
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );
      const started = yield* service.signIn.start;
      assert.strictEqual(started.userCode, "BCDF-GHJK");
      assert.strictEqual(fetch.mock.calls.length, 2);
      assert.isTrue(signals.every((signal) => signal?.aborted === true));
    }),
  );
});
