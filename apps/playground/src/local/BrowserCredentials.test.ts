import { Effect, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { describe, expect, it, vi } from "vitest";

import type { StorageLike } from "./LocalStoragePersistence";

import { MACROGRAPH_AUTH_SESSION_KEY, makeBrowserCredentialProvider } from "./BrowserCredentials";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const issuer = "https://macrograph.app";

/** Answers the authorization server's discovery, device, token and credential endpoints. */
const fakeAuthorizationServer = (credentials: unknown = []) =>
  vi.fn<(request: HttpClientRequest.HttpClientRequest) => Response>((request) => {
    const path = new URL(request.url).pathname;
    if (path === "/.well-known/oauth-authorization-server")
      return json({
        issuer,
        device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
        token_endpoint: `${issuer}/oauth/token`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        jwks_uri: `${issuer}/oauth/jwks`,
      });
    if (path === "/oauth/device_authorization")
      return json({
        device_code: "device-1",
        user_code: "BCDF-GHJK",
        verification_uri: `${issuer}/device`,
        verification_uri_complete: `${issuer}/device?user_code=BCDF-GHJK`,
        expires_in: 600,
        interval: 5,
      });
    if (path === "/oauth/token")
      return json({
        access_token: "mgat_access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "mgrt_rotated",
      });
    if (path === "/oauth/revoke") return new Response(null, { status: 200 });
    if (path === "/api/credentials") return json(credentials);
    return json({ error: "not_found" }, 404);
  });

const connectedState = JSON.stringify({
  version: 2,
  grant: {
    refreshToken: "mgrt_initial",
    scope: "openid email offline_access credentials",
    userId: "user-1",
    email: "user@example.com",
  },
});

describe("browser MacroGraph credentials", () => {
  it("starts the device flow as the playground's public client", async () => {
    const storage = new MemoryStorage();
    const respond = fakeAuthorizationServer();
    const http = HttpClient.make((request) =>
      Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
    );
    const provider = Effect.runSync(
      makeBrowserCredentialProvider({ storage }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      ),
    );
    expect(await Effect.runPromise(provider.service.auth!.start)).toEqual({
      state: "pending",
      verificationUrl: `${issuer}/device?user_code=BCDF-GHJK`,
      userCode: "BCDF-GHJK",
    });
    const device = respond.mock.calls.find(([request]) =>
      request.url.endsWith("/oauth/device_authorization"),
    )?.[0];
    expect(device?.body._tag).toBe("Uint8Array");
    if (device?.body._tag === "Uint8Array")
      expect(new TextDecoder().decode(device.body.body)).toBe(
        "scope=openid+email+offline_access+credentials&client_id=macrograph-playground",
      );
    expect(storage.getItem(MACROGRAPH_AUTH_SESSION_KEY)).toContain("BCDF-GHJK");
  });

  it("restores a stored grant, rotates its refresh token, and reads credentials", async () => {
    const storage = new MemoryStorage();
    storage.setItem(MACROGRAPH_AUTH_SESSION_KEY, connectedState);
    const respond = fakeAuthorizationServer([
      {
        provider: "twitch",
        id: "twitch-1",
        displayName: "Streamer",
        scopes: ["user:read:chat"],
        metadata: { clientId: "custom-client" },
        token: {
          access_token: "twitch-access",
          expires_in: 3600,
          token_type: "bearer",
          issuedAt: 1,
        },
      },
    ]);
    const http = HttpClient.make((request) =>
      Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
    );
    const restored = Effect.runSync(
      makeBrowserCredentialProvider({ storage }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      ),
    );
    expect(await Effect.runPromise(restored.service.auth!.status)).toEqual({
      state: "connected",
      identity: { id: "user-1", displayName: "user@example.com" },
    });
    const credentials = await Effect.runPromise(restored.service.get);
    expect(credentials[0]?.clientId).toBe("custom-client");
    expect(Redacted.value(credentials[0]!.token.access)).toBe("twitch-access");
    expect(storage.getItem(MACROGRAPH_AUTH_SESSION_KEY)).toContain("mgrt_rotated");
    const credentialRequest = respond.mock.calls.find(([request]) =>
      request.url.endsWith("/api/credentials"),
    )?.[0];
    expect(credentialRequest?.headers.authorization).toBe("Bearer mgat_access");

    await Effect.runPromise(restored.service.auth!.disconnect);
    expect(storage.getItem(MACROGRAPH_AUTH_SESSION_KEY)).not.toContain("grant");
  });

  it("returns an actionable error when localStorage rejects authorization writes", async () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {},
    };
    const respond = fakeAuthorizationServer();
    const provider = Effect.runSync(
      makeBrowserCredentialProvider({ storage }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
          ),
        ),
      ),
    );
    await expect(Effect.runPromise(provider.service.auth!.start)).rejects.toMatchObject({
      reason: expect.stringContaining("persist"),
    });
  });
});
