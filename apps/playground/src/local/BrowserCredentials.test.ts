import { Effect, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
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

describe("browser MacroGraph credentials", () => {
  it("persists authorization in namespaced localStorage and restores cloud credentials", async () => {
    const storage = new MemoryStorage();
    const respond = vi.fn<(request: HttpClientRequest.HttpClientRequest) => Response>((request) => {
      const url = request.url;
      if (url.endsWith("/server/registration/start"))
        return json({
          id: "registration-1",
          userCode: "ABCD",
          verification_uri: "https://www.macrograph.app/connect",
          verification_uri_complete: "https://www.macrograph.app/connect?code=ABCD",
        });
      if (url.endsWith("/server/registration") && request.method === "POST")
        return json({ token: "session-secret" });
      if (url.endsWith("/server/registration")) return json({ ownerId: "user-1" });
      if (url.endsWith("/user")) return json({ id: "user-1", email: "user@example.com" });
      return json([
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
    });
    const http = HttpClient.make((request) =>
      Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
    );
    const first = Effect.runSync(
      makeBrowserCredentialProvider({ storage, now: () => 1_000 }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      ),
    );
    const auth = first.service.auth;
    expect(auth).toBeDefined();
    expect(await Effect.runPromise(auth!.start)).toMatchObject({ state: "pending" });
    expect(storage.getItem(MACROGRAPH_AUTH_SESSION_KEY)).toContain("registration-1");
    expect(await Effect.runPromise(auth!.poll)).toEqual({
      state: "connected",
      identity: { id: "user-1", displayName: "user@example.com" },
    });

    const restored = Effect.runSync(
      makeBrowserCredentialProvider({ storage, now: () => 2_000 }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      ),
    );
    expect(await Effect.runPromise(restored.service.auth!.status)).toMatchObject({
      state: "connected",
    });
    const credentials = await Effect.runPromise(restored.service.get);
    expect(credentials[0]?.clientId).toBe("custom-client");
    expect(Redacted.value(credentials[0]!.token.access)).toBe("twitch-access");
    expect(respond.mock.calls.some(([request]) => request.url.includes("id.twitch.tv"))).toBe(
      false,
    );

    await Effect.runPromise(restored.service.auth!.disconnect);
    expect(storage.getItem(MACROGRAPH_AUTH_SESSION_KEY)).toBeNull();
  });

  it("returns an actionable error when localStorage rejects authorization writes", async () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {},
    };
    const provider = Effect.runSync(
      makeBrowserCredentialProvider({ storage }).pipe(
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
    await expect(Effect.runPromise(provider.service.auth!.start)).rejects.toMatchObject({
      reason: expect.stringContaining("persist"),
    });
  });
});
