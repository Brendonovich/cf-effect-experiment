import { Effect, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  MACROGRAPH_AUTH_SESSION_KEY,
  makeBrowserCredentialProvider,
} from "./BrowserCredentials";
import type { StorageLike } from "./LocalStoragePersistence";

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
  Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

describe("browser MacroGraph credentials", () => {
  it("persists authorization in namespaced localStorage and restores cloud credentials", async () => {
    const storage = new MemoryStorage();
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = String(input);
      if (url.endsWith("/server/registration/start"))
        return json({
          id: "registration-1",
          userCode: "ABCD",
          verification_uri: "https://www.macrograph.app/connect",
          verification_uri_complete: "https://www.macrograph.app/connect?code=ABCD",
        });
      if (url.endsWith("/server/registration") && init?.method === "POST")
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
    const first = makeBrowserCredentialProvider({ storage, fetch, now: () => 1_000 });
    const auth = first.service.auth;
    expect(auth).toBeDefined();
    expect(await Effect.runPromise(auth!.start)).toMatchObject({ state: "pending" });
    expect(storage.getItem(MACROGRAPH_AUTH_SESSION_KEY)).toContain("registration-1");
    expect(await Effect.runPromise(auth!.poll)).toEqual({
      state: "connected",
      identity: { id: "user-1", displayName: "user@example.com" },
    });

    const restored = makeBrowserCredentialProvider({ storage, fetch, now: () => 2_000 });
    expect(await Effect.runPromise(restored.service.auth!.status)).toMatchObject({
      state: "connected",
    });
    const credentials = await Effect.runPromise(restored.service.get);
    expect(credentials[0]?.clientId).toBe("custom-client");
    expect(Redacted.value(credentials[0]!.token.access)).toBe("twitch-access");
    expect(fetch.mock.calls.some(([input]) => String(input).includes("id.twitch.tv"))).toBe(false);

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
    const provider = makeBrowserCredentialProvider({
      storage,
      fetch: vi.fn<typeof globalThis.fetch>(() =>
        json({
          id: "registration-1",
          userCode: "ABCD",
          verification_uri: "https://www.macrograph.app/connect",
          verification_uri_complete: "https://www.macrograph.app/connect?code=ABCD",
        }),
      ),
    });
    await expect(Effect.runPromise(provider.service.auth!.start)).rejects.toMatchObject({
      reason: expect.stringContaining("persist"),
    });
  });
});
