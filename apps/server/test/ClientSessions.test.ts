import { Effect } from "effect";
import { Headers } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import type { AtomicFileStore } from "../src/AtomicFileStore.ts";

import { ClientSessions } from "../src/ClientSessions.ts";

describe("client sessions", () => {
  it("grants edits only to the registered owner and configured admins", async () => {
    let stored: string | null = null;
    const store: AtomicFileStore = {
      read: Effect.sync(() => stored),
      write: (value) => Effect.sync(() => (stored = value)),
      clear: Effect.sync(() => (stored = null)),
    };
    const sessions = ClientSessions.make(store);
    const ownerToken = await Effect.runPromise(
      sessions.create({ userId: "owner", email: "owner@example.com" }),
    );
    const adminToken = await Effect.runPromise(
      sessions.create({ userId: "admin", email: "admin@example.com" }),
    );
    const readerToken = await Effect.runPromise(
      sessions.create({ userId: "reader", email: "reader@example.com" }),
    );
    const policy = sessions.policy(Effect.succeed("owner"), new Set(["admin"]));
    const resolve = (token?: string) =>
      Effect.runPromise(
        policy.resolve(
          Headers.fromInput(token === undefined ? {} : { "x-macrograph-session": token }),
          1,
        ),
      );

    expect((await resolve()).canEdit).toBe(false);
    expect((await resolve(ownerToken)).canEdit).toBe(true);
    expect((await resolve(ownerToken)).canManageCredentials).toBe(true);
    expect((await resolve(adminToken)).canEdit).toBe(true);
    expect((await resolve(adminToken)).canManageCredentials).toBe(false);
    expect((await resolve(readerToken)).canEdit).toBe(false);

    await Effect.runPromise(sessions.remove(ownerToken));
    expect(await sessions.resolve(ownerToken).pipe(Effect.runPromise)).toBeUndefined();
  });

  it("allows an anonymous client to register an unclaimed server without edit access", async () => {
    const sessions = ClientSessions.make({
      read: Effect.succeed(null),
      write: () => Effect.void,
      clear: Effect.void,
    });
    const identity = await Effect.runPromise(
      sessions.policy(Effect.succeed(undefined), new Set()).resolve(Headers.empty, 0),
    );

    expect(identity.canEdit).toBe(false);
    expect(identity.canManageCredentials).toBe(true);
  });
});
