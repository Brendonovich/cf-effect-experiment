import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Headers } from "effect/unstable/http";

import type { AtomicFileStore } from "../src/AtomicFileStore.ts";

import { ClientSessions } from "../src/ClientSessions.ts";

describe("client sessions", () => {
  it.effect("grants edits only to the registered owner and configured admins", () =>
    Effect.gen(function* () {
      let stored: string | null = null;
      const store: AtomicFileStore = {
        read: Effect.sync(() => stored),
        write: (value) => Effect.sync(() => (stored = value)),
        clear: Effect.sync(() => (stored = null)),
      };
      const sessions = ClientSessions.make(store);
      const ownerToken = yield* sessions.create({ userId: "owner", email: "owner@example.com" });
      const adminToken = yield* sessions.create({ userId: "admin", email: "admin@example.com" });
      const readerToken = yield* sessions.create({ userId: "reader", email: "reader@example.com" });
      const policy = sessions.policy(Effect.succeed("owner"), new Set(["admin"]));
      const resolve = (token?: string) =>
        policy.resolve(
          Headers.fromInput(token === undefined ? {} : { "x-macrograph-session": token }),
          1,
        );

      assert.isFalse((yield* resolve()).canEdit);
      assert.isFalse((yield* resolve()).canManageCredentials);
      assert.isTrue((yield* resolve(ownerToken)).canEdit);
      assert.isTrue((yield* resolve(ownerToken)).canManageCredentials);
      assert.isTrue((yield* resolve(adminToken)).canEdit);
      assert.isFalse((yield* resolve(adminToken)).canManageCredentials);
      assert.isFalse((yield* resolve(readerToken)).canEdit);
      assert.isFalse((yield* resolve(readerToken)).canManageCredentials);

      yield* sessions.remove(ownerToken);
      assert.isUndefined(yield* sessions.resolve(ownerToken));
      assert.isFalse((yield* resolve(ownerToken)).canEdit);
      assert.isFalse((yield* resolve(ownerToken)).canManageCredentials);
    }),
  );

  it.effect(
    "does not let anonymous clients edit or manage credentials on an unclaimed server",
    () =>
      Effect.gen(function* () {
        const sessions = ClientSessions.make({
          read: Effect.succeed(null),
          write: () => Effect.void,
          clear: Effect.void,
        });
        const identity = yield* sessions
          .policy(Effect.succeed(undefined), new Set())
          .resolve(Headers.empty, 0);

        assert.isFalse(identity.canEdit);
        assert.isFalse(identity.canManageCredentials);
      }),
  );

  for (const stored of [
    null,
    "{}",
    JSON.stringify({ valid: { userId: "owner", email: "owner@example.com" } }),
  ]) {
    it.effect(`rejects inherited session tokens with store ${stored}`, () =>
      Effect.gen(function* () {
        const sessions = ClientSessions.make({
          read: Effect.succeed(stored),
          write: () => Effect.die("Removing an inherited token must not write the store"),
          clear: Effect.void,
        });
        for (const owner of [undefined, "owner"]) {
          const policy = sessions.policy(Effect.succeed(owner), new Set(["admin"]));
          for (const token of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
            assert.isUndefined(yield* sessions.resolve(token));
            for (const headers of [
              { "x-macrograph-session": token },
              { authorization: `Bearer ${token}` },
            ]) {
              const identity = yield* policy.resolve(Headers.fromInput(headers), 1);
              assert.isFalse(identity.canEdit);
              assert.isFalse(identity.canManageCredentials);
              assert.strictEqual(identity.displayName, "");
            }
            yield* sessions.remove(token);
          }
        }
      }),
    );
  }
});
