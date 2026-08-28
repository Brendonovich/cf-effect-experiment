import { assert, describe, it } from "@effect/vitest";
import { CloudCredentials, SESSION_LIFETIME_MS } from "@macrograph/cloud-credentials";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { Headers, HttpClient, HttpClientResponse } from "effect/unstable/http";

import { type AtomicFileStore, AtomicFileStoreError } from "../src/AtomicFileStore.ts";
import { ClientSessions } from "../src/ClientSessions.ts";
import { ServerSetup, SetupError } from "../src/ServerSetup.ts";

const memoryStore = (initial: string | null = null) => {
  let stored = initial;
  return {
    read: Effect.sync(() => stored),
    write: (value: string) =>
      Effect.sync(() => {
        stored = value;
      }),
    clear: Effect.sync(() => {
      stored = null;
    }),
  } satisfies AtomicFileStore;
};

const makeHarness = (
  options: {
    owner?: string;
    legacy?: string;
    now?: () => number;
  } = {},
) => {
  const store = memoryStore(options.owner);
  const legacyAuthStore = memoryStore(options.legacy);
  const sessionStore = memoryStore();
  const requests: string[] = [];
  let approved = false;
  const http = HttpClient.make((outgoing, url) =>
    Effect.sync(() => {
      const request = `${outgoing.method} ${url.pathname}`;
      const json = (value: unknown, status = 200) =>
        HttpClientResponse.fromWeb(outgoing, Response.json(value, { status }));
      requests.push(request);
      switch (request) {
        case "POST /api/server/registration/start":
          return json({
            id: "registration-id",
            userCode: "CODE",
            verification_uri: "https://www.macrograph.app/register",
            verification_uri_complete: "https://www.macrograph.app/register?code=CODE",
          });
        case "POST /api/server/registration":
          assert.strictEqual(outgoing.body._tag, "Uint8Array");
          if (outgoing.body._tag === "Uint8Array")
            assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(outgoing.body.body)), {
              id: "registration-id",
            });
          return approved
            ? json({ token: "cloud-token" })
            : json({ _tag: "ServerRegistrationError", code: "authorization_pending" }, 400);
        case "GET /api/server/registration":
        case "GET /api/user":
          assert.strictEqual(outgoing.headers.authorization, "Bearer cloud-token");
          return json(
            request.endsWith("/user")
              ? { id: "owner", email: "owner@example.com" }
              : { ownerId: "owner" },
          );
        default:
          throw new Error(`Unexpected cloud request: ${request}`);
      }
    }),
  );
  const cloud = Effect.runSync(
    CloudCredentials.make({
      store: legacyAuthStore,
      now: options.now ?? (() => 0),
    }).pipe(Effect.provideService(HttpClient.HttpClient, http)),
  );
  const sessions = ClientSessions.make(sessionStore);
  const setup = ServerSetup.make({ store, legacyAuthStore, auth: cloud.auth, sessions });
  return {
    store,
    legacyAuthStore,
    sessionStore,
    cloud,
    http,
    sessions,
    setup,
    requests,
    approve: () => {
      approved = true;
    },
  };
};

describe("ServerSetup", () => {
  it.effect("rejects empty and incorrect keys without starting or polling cloud registration", () =>
    Effect.gen(function* () {
      const { setup, requests, store, legacyAuthStore, sessionStore } = makeHarness();
      const key = yield* setup.setupKey;
      assert.isDefined(key);
      assert.match(key!, /^[A-Za-z0-9_-]{43}$/);
      assert.strictEqual(yield* setup.setupKey, key);
      for (const invalid of [
        "",
        "wrong",
        `${key}extra`,
        `${key![0] === "A" ? "B" : "A"}${key!.slice(1)}`,
      ]) {
        for (const operation of [setup.start, setup.poll]) {
          const result = yield* Effect.exit<unknown, unknown, never>(operation(invalid));
          assert.deepStrictEqual(
            result,
            Exit.fail(new SetupError({ reason: "Invalid setup key" })),
          );
        }
      }
      assert.isUndefined(yield* setup.ownerId);
      assert.isNull(yield* store.read);
      assert.isNull(yield* legacyAuthStore.read);
      assert.isNull(yield* sessionStore.read);
      assert.deepStrictEqual(requests, []);
    }),
  );

  it.effect("rejects polling before setup has started", () =>
    Effect.gen(function* () {
      const { setup, requests } = makeHarness();
      const key = (yield* setup.setupKey)!;
      const result = yield* Effect.exit(setup.poll(key));
      assert.deepStrictEqual(
        result,
        Exit.fail(new SetupError({ reason: "Start setup before approving it" })),
      );
      assert.deepStrictEqual(requests, []);
      assert.isUndefined(yield* setup.ownerId);
    }),
  );

  it.effect(
    "claims a pending cloud registration, persists the owner, and authenticates a durable local session",
    () =>
      Effect.gen(function* () {
        const {
          setup,
          sessions,
          cloud,
          http,
          store,
          legacyAuthStore,
          sessionStore,
          approve,
          requests,
        } = makeHarness();
        const key = (yield* setup.setupKey)!;
        const pending = yield* setup.start(key);
        assert.deepStrictEqual(pending, {
          state: "pending",
          verificationUrl: "https://www.macrograph.app/register?code=CODE",
        });
        if (pending.state !== "pending") return assert.fail("Expected a pending registration");
        assert.deepStrictEqual(yield* setup.start(key), pending);
        assert.deepStrictEqual(yield* setup.poll(key), pending);
        assert.isUndefined(yield* setup.ownerId);
        assert.isNull(yield* store.read);
        assert.isNull(yield* sessionStore.read);
        approve();
        const result = yield* setup.poll(key);
        assert.strictEqual(result.state, "connected");
        if (result.state !== "connected") return assert.fail("Expected a connected local session");
        assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
        assert.notStrictEqual(result.token, "cloud-token");
        assert.notStrictEqual(result.token, key);
        assert.deepStrictEqual(yield* sessions.resolve(result.token), {
          userId: "owner",
          email: "owner@example.com",
        });
        assert.strictEqual(yield* setup.ownerId, "owner");
        assert.deepStrictEqual(JSON.parse((yield* store.read)!), { ownerId: "owner" });
        assert.isUndefined(yield* setup.setupKey);
        assert.deepStrictEqual(yield* cloud.auth.status, {
          state: "connected",
          identity: { id: "owner", displayName: "owner@example.com" },
        });

        const restartedSessions = ClientSessions.make(sessionStore);
        const restarted = ServerSetup.make({
          store,
          legacyAuthStore,
          sessions: restartedSessions,
          auth: (yield* CloudCredentials.make({ store: legacyAuthStore }).pipe(
            Effect.provideService(HttpClient.HttpClient, http),
          )).auth,
        });
        assert.strictEqual(yield* restarted.ownerId, "owner");
        assert.isUndefined(yield* restarted.setupKey);
        const identity = yield* restartedSessions
          .policy(restarted.ownerId, new Set())
          .resolve(Headers.fromInput({ authorization: `Bearer ${result.token}` }), 1);
        assert.isTrue(identity.canEdit);
        assert.isTrue(identity.canManageCredentials);
        for (const operation of [setup.start, setup.poll, restarted.start, restarted.poll]) {
          assert.deepStrictEqual(
            yield* Effect.exit<unknown, unknown, never>(operation(key)),
            Exit.fail(new SetupError({ reason: "This server has already been configured" })),
          );
        }
        assert.deepStrictEqual(requests, [
          "POST /api/server/registration/start",
          "POST /api/server/registration",
          "POST /api/server/registration",
          "GET /api/server/registration",
          "GET /api/user",
        ]);
      }),
  );

  it.effect("allows only one concurrent poll to persist ownership and issue a session", () =>
    Effect.gen(function* () {
      const { store, legacyAuthStore, sessionStore, sessions, cloud, approve, requests } =
        makeHarness();
      const writing = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let writes = 0;
      const setup = ServerSetup.make({
        store: {
          ...store,
          write: (value) =>
            Effect.gen(function* () {
              writes++;
              yield* Deferred.succeed(writing, undefined);
              yield* Deferred.await(release);
              yield* store.write(value);
            }),
        },
        legacyAuthStore,
        sessions,
        auth: cloud.auth,
      });
      const key = (yield* setup.setupKey)!;
      yield* setup.start(key);
      approve();
      const first = yield* setup.poll(key).pipe(Effect.exit, Effect.forkChild);
      yield* Deferred.await(writing);
      const second = yield* setup.poll(key).pipe(Effect.exit, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      assert.isTrue(Exit.isSuccess(yield* Fiber.join(first)));
      const rejected = yield* Fiber.join(second);
      assert.deepStrictEqual(
        rejected,
        Exit.fail(new SetupError({ reason: "This server has already been configured" })),
      );
      assert.strictEqual(writes, 1);
      assert.lengthOf(Object.keys(JSON.parse((yield* sessionStore.read)!)), 1);
      assert.lengthOf(
        requests.filter((request) => request === "POST /api/server/registration"),
        1,
      );
    }),
  );

  for (const reason of ["disconnect", "expiry"]) {
    it.effect(`keeps ownership and local access after cloud ${reason}`, () =>
      Effect.gen(function* () {
        let now = 0;
        const { setup, store, legacyAuthStore, sessions, cloud, approve } = makeHarness({
          now: () => now,
        });
        const key = (yield* setup.setupKey)!;
        yield* setup.start(key);
        approve();
        const result = yield* setup.poll(key);
        if (result.state !== "connected") return assert.fail("Expected a connected local session");
        if (reason === "disconnect") yield* cloud.auth.disconnect;
        else now = SESSION_LIFETIME_MS;
        assert.deepStrictEqual(yield* cloud.auth.status, { state: "disconnected" });
        assert.isNull(yield* legacyAuthStore.read);
        const restarted = ServerSetup.make({ store, legacyAuthStore, sessions, auth: cloud.auth });
        for (const current of [setup, restarted]) {
          assert.strictEqual(yield* current.ownerId, "owner");
          assert.isUndefined(yield* current.setupKey);
          const identity = yield* sessions
            .policy(current.ownerId, new Set())
            .resolve(Headers.fromInput({ "x-macrograph-session": result.token }), 1);
          assert.isTrue(identity.canEdit);
          assert.isTrue(identity.canManageCredentials);
        }
      }),
    );
  }

  for (const expiresAt of [0, SESSION_LIFETIME_MS]) {
    it.effect(
      `migrates legacy ownership before loading cloud status with expiry ${expiresAt}`,
      () =>
        Effect.gen(function* () {
          const legacy = JSON.stringify({
            state: "connected",
            token: "legacy-token",
            userId: "legacy-owner",
            email: "legacy@example.com",
            expiresAt,
          });
          const { setup, store, legacyAuthStore, sessionStore, cloud, requests } = makeHarness({
            legacy,
          });
          assert.isUndefined(yield* setup.setupKey);
          assert.strictEqual(yield* setup.ownerId, "legacy-owner");
          assert.deepStrictEqual(JSON.parse((yield* store.read)!), { ownerId: "legacy-owner" });
          assert.strictEqual(yield* legacyAuthStore.read, legacy);
          assert.isNull(yield* sessionStore.read);
          assert.strictEqual(
            (yield* cloud.auth.status).state,
            expiresAt === 0 ? "disconnected" : "connected",
          );
          if (expiresAt === 0) assert.isNull(yield* legacyAuthStore.read);
          assert.strictEqual(yield* setup.ownerId, "legacy-owner");
          assert.deepStrictEqual(requests, []);
        }),
    );
  }

  it.effect("uses durable ownership instead of a different legacy cloud identity", () =>
    Effect.gen(function* () {
      const { setup, store } = makeHarness({
        owner: JSON.stringify({ ownerId: "original-owner" }),
        legacy: JSON.stringify({ state: "connected", userId: "other-user" }),
      });
      assert.strictEqual(yield* setup.ownerId, "original-owner");
      assert.isUndefined(yield* setup.setupKey);
      assert.deepStrictEqual(JSON.parse((yield* store.read)!), { ownerId: "original-owner" });
    }),
  );

  it.effect(
    "rotates the unclaimed setup key on restart and does not adopt the old pending registration",
    () =>
      Effect.gen(function* () {
        const { setup, store, legacyAuthStore, sessions, cloud, requests } = makeHarness();
        const oldKey = (yield* setup.setupKey)!;
        yield* setup.start(oldKey);
        const restarted = ServerSetup.make({ store, legacyAuthStore, sessions, auth: cloud.auth });
        const newKey = (yield* restarted.setupKey)!;
        assert.notStrictEqual(newKey, oldKey);
        for (const operation of [restarted.start, restarted.poll]) {
          assert.deepStrictEqual(
            yield* Effect.exit<unknown, unknown, never>(operation(oldKey)),
            Exit.fail(new SetupError({ reason: "Invalid setup key" })),
          );
        }
        assert.deepStrictEqual(
          yield* Effect.exit(restarted.poll(newKey)),
          Exit.fail(new SetupError({ reason: "Start setup before approving it" })),
        );
        assert.strictEqual((yield* restarted.start(newKey)).state, "pending");
        assert.deepStrictEqual(requests, [
          "POST /api/server/registration/start",
          "POST /api/server/registration/start",
        ]);
        assert.isUndefined(yield* restarted.ownerId);
      }),
  );

  for (const field of ["owner", "legacy"] as const) {
    for (const raw of [
      "not json",
      "null",
      "{}",
      JSON.stringify(field === "owner" ? { ownerId: 1 } : { state: "connected", userId: 1 }),
    ]) {
      it.effect(`fails closed for invalid ${field} store ${raw}`, () =>
        Effect.gen(function* () {
          const { setup, store, legacyAuthStore, sessionStore, requests } = makeHarness({
            [field]: raw,
          });
          for (const operation of [
            setup.ownerId,
            setup.setupKey,
            setup.start("key"),
            setup.poll("key"),
          ]) {
            assert.isTrue(Exit.hasDies(yield* Effect.exit<unknown, unknown, never>(operation)));
          }
          assert.strictEqual(yield* (field === "owner" ? store : legacyAuthStore).read, raw);
          assert.isNull(yield* sessionStore.read);
          assert.deepStrictEqual(requests, []);
        }),
      );
    }
  }

  it.effect("does not grant ownership or a session when persisting the owner fails", () =>
    Effect.gen(function* () {
      const { store, legacyAuthStore, sessionStore, sessions, cloud, approve } = makeHarness();
      const failure = new AtomicFileStoreError({ reason: "Disk full" });
      const setup = ServerSetup.make({
        store: { ...store, write: () => Effect.fail(failure) },
        legacyAuthStore,
        sessions,
        auth: cloud.auth,
      });
      const key = (yield* setup.setupKey)!;
      yield* setup.start(key);
      approve();
      assert.deepStrictEqual(yield* Effect.exit(setup.poll(key)), Exit.die(failure));
      assert.strictEqual((yield* cloud.auth.status).state, "connected");
      assert.isUndefined(yield* setup.ownerId);
      assert.strictEqual(yield* setup.setupKey, key);
      assert.isNull(yield* store.read);
      assert.isNull(yield* sessionStore.read);
      const identity = yield* sessions.policy(setup.ownerId, new Set()).resolve(Headers.empty, 1);
      assert.isFalse(identity.canEdit);
      assert.isFalse(identity.canManageCredentials);
    }),
  );
});
