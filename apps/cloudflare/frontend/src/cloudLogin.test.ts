import type { SessionStatus, WebsiteSession } from "@macrograph/cloud-api";

import { Effect } from "effect";
import { afterEach, assert, describe, it, vi } from "vitest";

import { cloudLogin } from "./cloudLogin";

const connected: SessionStatus = { state: "connected", userId: "user", email: "user@example.com" };
const supplied: SessionStatus = {
  state: "pending",
  verificationUrl: "https://www.macrograph.app/server-registration?userCode=OLD1-CODE",
};
const fresh: WebsiteSession = {
  registrationId: "01234567-89ab-4cde-8fab-0123456789ab",
  verificationUrl: "https://www.macrograph.app/server-registration?userCode=NEW1-CODE",
};
const renewed: WebsiteSession = {
  registrationId: "01234567-89ab-4cde-8fab-0123456789ac",
  verificationUrl: "https://www.macrograph.app/server-registration?userCode=NEW2-CODE",
};

const makeSession = () => ({
  get: vi.fn(() => Effect.succeed<SessionStatus>(supplied)),
  start: vi.fn(() => Effect.succeed<SessionStatus>(supplied)),
  poll: vi.fn(() => Effect.succeed<SessionStatus>(connected)),
  startWebsite: vi.fn(() => Effect.succeed<WebsiteSession>(fresh)),
  pollWebsite: vi.fn((_options: { payload: { registrationId: string } }) =>
    Effect.succeed<SessionStatus>(connected),
  ),
});
const sleep = () => Promise.resolve();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cloud login", () => {
  it("fails without starting another registration when website registration is unavailable", async () => {
    const session = makeSession();
    session.get.mockReturnValue(Effect.succeed({ state: "disconnected" }));
    session.startWebsite.mockReturnValue(Effect.die("unavailable"));
    const login = cloudLogin(session, true, sleep);

    assert.deepEqual((await login.next()).value, { state: "failed" });
    assert.isTrue((await login.next()).done);
    assert.strictEqual(session.start.mock.calls.length, 0);
    assert.strictEqual(session.poll.mock.calls.length, 0);
  });

  it.each(["get", "start", "poll", "startWebsite", "pollWebsite"] as const)(
    "fails and interrupts a stalled %s request",
    async (endpoint) => {
      vi.useFakeTimers();
      const session = makeSession();
      if (endpoint === "start" || endpoint === "startWebsite")
        session.get.mockReturnValue(Effect.succeed({ state: "disconnected" }));
      let interrupted = false;
      session[endpoint].mockReturnValue(
        Effect.never.pipe(Effect.ensuring(Effect.sync(() => (interrupted = true)))),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 })),
      );
      const login = cloudLogin(
        session,
        endpoint === "startWebsite" || endpoint === "pollWebsite",
        sleep,
      );
      if (endpoint === "pollWebsite") await login.next();

      const result = login.next();
      await vi.advanceTimersByTimeAsync(15_000);
      assert.deepEqual((await result).value, { state: "failed" });
      assert.isTrue(interrupted);
      assert.isTrue((await login.next()).done);
    },
  );

  it("replaces an existing pending attempt before approving through the website", async () => {
    const session = makeSession();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const login = cloudLogin(session, true, sleep);

    assert.deepEqual((await login.next()).value, {
      state: "pending",
      verificationUrl: fresh.verificationUrl,
    });
    assert.deepEqual((await login.next()).value, connected);
    assert.strictEqual(session.startWebsite.mock.calls.length, 1);
    assert.strictEqual(session.poll.mock.calls.length, 0);
    assert.deepEqual(session.pollWebsite.mock.calls[0], [
      { payload: { registrationId: fresh.registrationId } },
    ]);
    assert.deepEqual(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)), { userCode: "NEW1-CODE" });
  });

  it("reuses a website session established while the sign-in page is already open", async () => {
    const session = makeSession();
    session.get.mockReturnValue(Effect.succeed({ state: "disconnected" }));
    const pending: SessionStatus = { state: "pending", verificationUrl: fresh.verificationUrl };
    session.pollWebsite.mockReturnValue(Effect.succeed(pending));
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const login = cloudLogin(session, true, sleep);

    assert.deepEqual((await login.next()).value, pending);
    for (let poll = 0; poll < 5; poll++) {
      assert.deepEqual((await login.next()).value, pending);
    }
    assert.strictEqual(fetch.mock.calls.length, 1);

    session.pollWebsite.mockReturnValue(Effect.succeed(connected));
    assert.deepEqual((await login.next()).value, connected);
    assert.strictEqual(fetch.mock.calls.length, 2);
    assert.strictEqual(fetch.mock.calls[1]?.[1]?.credentials, "include");
    assert.strictEqual(session.startWebsite.mock.calls.length, 1);
    assert.strictEqual(session.start.mock.calls.length, 0);
    assert.isTrue((await login.next()).done);
  });

  it("never approves the existing pending attempt when starting a fresh one fails", async () => {
    const session = makeSession();
    session.startWebsite.mockReturnValue(Effect.die("unavailable"));
    session.poll.mockReturnValueOnce(Effect.succeed(supplied));
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const login = cloudLogin(session, true, sleep);

    assert.deepEqual((await login.next()).value, supplied);
    assert.deepEqual((await login.next()).value, connected);
    assert.strictEqual(fetch.mock.calls.length, 0);
    assert.strictEqual(session.pollWebsite.mock.calls.length, 0);
  });

  it("keeps attempts in different tabs independent of the shared session cookie", async () => {
    const session = makeSession();
    session.startWebsite
      .mockReturnValueOnce(Effect.succeed(fresh))
      .mockReturnValueOnce(Effect.succeed(renewed));
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 })),
    );
    const first = cloudLogin(session, true, sleep);
    const second = cloudLogin(session, true, sleep);
    await first.next();
    await second.next();
    assert.deepEqual((await first.next()).value, connected);
    assert.deepEqual((await second.next()).value, connected);
    assert.deepEqual(
      session.pollWebsite.mock.calls.map(([options]) => options.payload.registrationId),
      [fresh.registrationId, renewed.registrationId],
    );
    assert.strictEqual(session.poll.mock.calls.length, 0);
  });

  it("renews expired attempts after the website confirms it is signed in", async () => {
    const session = makeSession();
    session.startWebsite
      .mockReturnValueOnce(Effect.succeed(fresh))
      .mockReturnValueOnce(Effect.succeed(renewed));
    session.pollWebsite.mockReturnValueOnce(
      Effect.succeed({ state: "pending", verificationUrl: fresh.verificationUrl }),
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    fetch.mockResolvedValueOnce(new Response(null, { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    const login = cloudLogin(session, true, sleep);
    await login.next();
    assert.deepEqual((await login.next()).value, {
      state: "pending",
      verificationUrl: renewed.verificationUrl,
    });
    assert.deepEqual((await login.next()).value, connected);
    assert.deepEqual(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)), { userCode: "NEW2-CODE" });
    assert.deepEqual(session.pollWebsite.mock.calls[1], [
      { payload: { registrationId: renewed.registrationId } },
    ]);
  });

  it("keeps an old manual attempt when the website is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = makeSession();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 401 })),
    );
    const login = cloudLogin(session, true, sleep);
    await login.next();
    vi.setSystemTime(11 * 60 * 1000);
    assert.deepEqual((await login.next()).value, connected);
    assert.strictEqual(session.startWebsite.mock.calls.length, 1);
    assert.deepEqual(session.pollWebsite.mock.calls[0], [
      { payload: { registrationId: fresh.registrationId } },
    ]);
  });

  it("honors manual approval that races with an automatic retry", async () => {
    const session = makeSession();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 409 })),
    );
    const login = cloudLogin(session, true, sleep);
    await login.next();
    assert.deepEqual((await login.next()).value, connected);
    assert.strictEqual(session.startWebsite.mock.calls.length, 1);
  });

  it("preserves manual login when automatic website login is disabled", async () => {
    const session = makeSession();
    session.get.mockReturnValue(Effect.succeed({ state: "disconnected" }));
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const login = cloudLogin(session, false, sleep);
    assert.deepEqual((await login.next()).value, supplied);
    assert.deepEqual((await login.next()).value, connected);
    assert.strictEqual(session.start.mock.calls.length, 1);
    assert.strictEqual(session.startWebsite.mock.calls.length, 0);
    assert.strictEqual(fetch.mock.calls.length, 0);
  });

  it("does not replace an already connected account", async () => {
    const session = makeSession();
    session.get.mockReturnValue(Effect.succeed(connected));
    const login = cloudLogin(session, true, sleep);
    assert.deepEqual((await login.next()).value, connected);
    assert.isTrue((await login.next()).done);
    assert.strictEqual(session.startWebsite.mock.calls.length, 0);
  });

  it("still polls for manual approval if website login is unavailable", async () => {
    const session = makeSession();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => {
        throw new TypeError("offline");
      }),
    );
    const login = cloudLogin(session, true, sleep);
    await login.next();
    assert.deepEqual((await login.next()).value, connected);
    assert.strictEqual(session.pollWebsite.mock.calls.length, 1);
  });
});
