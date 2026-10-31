import { assert, describe, it } from "@effect/vitest";
import { Credential } from "@macrograph/module";
import { Effect, Exit } from "effect";

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
    get value() {
      return stored;
    },
  } satisfies AtomicFileStore & { readonly value: string | null };
};

/** An owner connection that stays pending until `approve` names the approving account. */
const fakeAuth = () => {
  const calls: Array<string> = [];
  let approver: string | undefined;
  let state: Credential.AuthStatus = { state: "disconnected" };
  const auth: Credential.AuthController = {
    providerName: "MacroGraph",
    status: Effect.sync(() => state),
    start: Effect.sync(() => {
      calls.push("start");
      state = {
        state: "pending",
        verificationUrl: "https://macrograph.app/device?user_code=BCDF-GHJK",
        userCode: "BCDF-GHJK",
      };
      return state;
    }),
    poll: Effect.sync(() => {
      calls.push("poll");
      if (state.state === "pending" && approver !== undefined)
        state = {
          state: "connected",
          identity: { id: approver, displayName: `${approver}@example.com` },
        };
      return state;
    }),
    disconnect: Effect.sync(() => {
      calls.push("disconnect");
      state = { state: "disconnected" };
    }),
  };
  return {
    auth,
    calls,
    approve: (account = "owner") => {
      approver = account;
    },
  };
};

const makeHarness = (options: { readonly owner?: string } = {}) => {
  const store = memoryStore(
    options.owner === undefined ? null : JSON.stringify({ ownerId: options.owner }),
  );
  const cloud = fakeAuth();
  const sessions = ClientSessions.make(memoryStore());
  const issued: Array<string> = [];
  const setup = ServerSetup.make({
    store,
    auth: cloud.auth,
    sessions,
    onKeyIssued: (key) =>
      Effect.sync(() => {
        issued.push(key);
      }),
  });
  return { store, cloud, sessions, setup, issued };
};

const keyOf = (setup: ReturnType<typeof makeHarness>["setup"]) =>
  setup.setupKey.pipe(
    Effect.map((key) => {
      assert.isString(key);
      return key!;
    }),
  );

describe("ServerSetup", () => {
  it.effect("issues one setup key while the server is unclaimed", () =>
    Effect.gen(function* () {
      const { setup, issued } = makeHarness();
      assert.deepStrictEqual(yield* setup.status, { ownerId: undefined, setupRequired: true });
      const key = yield* keyOf(setup);
      yield* setup.status;
      assert.deepStrictEqual(issued, [key]);
    }),
  );

  it.effect("rejects empty and incorrect keys without contacting MacroGraph", () =>
    Effect.gen(function* () {
      const { setup, cloud } = makeHarness();
      yield* keyOf(setup);
      for (const key of ["", "wrong"]) {
        assert.deepStrictEqual(
          yield* Effect.exit(setup.start(key)),
          Exit.fail(new SetupError({ reason: "Invalid setup key" })),
        );
        assert.deepStrictEqual(
          yield* Effect.exit(setup.poll(key)),
          Exit.fail(new SetupError({ reason: "Invalid setup key" })),
        );
      }
      assert.deepStrictEqual(cloud.calls, []);
    }),
  );

  it.effect("rejects polling before setup has started", () =>
    Effect.gen(function* () {
      const { setup } = makeHarness();
      const key = yield* keyOf(setup);
      assert.deepStrictEqual(
        yield* Effect.exit(setup.poll(key)),
        Exit.fail(new SetupError({ reason: "Start setup before approving it" })),
      );
    }),
  );

  it.effect("makes the approving account the owner and signs it in", () =>
    Effect.gen(function* () {
      const { setup, cloud, sessions, store } = makeHarness();
      const key = yield* keyOf(setup);
      const pending = yield* setup.start(key);
      assert.deepStrictEqual(pending, {
        state: "pending",
        verificationUrl: "https://macrograph.app/device?user_code=BCDF-GHJK",
        userCode: "BCDF-GHJK",
      });
      // A fresh key never adopts an authorization started earlier.
      assert.deepStrictEqual(cloud.calls, ["disconnect", "start"]);
      assert.strictEqual((yield* setup.poll(key)).state, "pending");

      cloud.approve("owner");
      const connected = yield* setup.poll(key);
      assert.strictEqual(connected.state, "connected");
      if (connected.state !== "connected" || !("token" in connected)) return;
      assert.deepStrictEqual(yield* sessions.resolve(connected.token), {
        userId: "owner",
        email: "owner@example.com",
      });
      assert.strictEqual(store.value, JSON.stringify({ ownerId: "owner" }));
      assert.deepStrictEqual(yield* setup.status, { ownerId: "owner", setupRequired: false });
      assert.isUndefined(yield* setup.setupKey);
      assert.deepStrictEqual(
        yield* Effect.exit(setup.start(key)),
        Exit.fail(new SetupError({ reason: "This server has already been configured" })),
      );
    }),
  );

  it.effect("lets only one concurrent poll claim the server", () =>
    Effect.gen(function* () {
      const { setup, cloud } = makeHarness();
      const key = yield* keyOf(setup);
      yield* setup.start(key);
      cloud.approve("owner");
      const results = yield* Effect.all([setup.poll(key), setup.poll(key)].map(Effect.exit), {
        concurrency: "unbounded",
      });
      const tokens = results.filter(
        (exit) => Exit.isSuccess(exit) && exit.value.state === "connected",
      );
      assert.lengthOf(tokens, 1);
    }),
  );

  it.effect("needs no setup when an owner is stored, even if their connection ended", () =>
    Effect.gen(function* () {
      const { setup, issued } = makeHarness({ owner: "owner" });
      assert.deepStrictEqual(yield* setup.status, { ownerId: "owner", setupRequired: false });
      assert.deepStrictEqual(issued, []);
    }),
  );

  for (const raw of ["not json", "{}", JSON.stringify({ ownerId: 1 })])
    it.effect(`fails closed for an invalid owner store ${raw}`, () =>
      Effect.gen(function* () {
        const setup = ServerSetup.make({
          store: memoryStore(raw),
          auth: fakeAuth().auth,
          sessions: ClientSessions.make(memoryStore()),
        });
        assert.isTrue(Exit.isFailure(yield* Effect.exit(setup.status)));
      }),
    );

  it.effect("does not sign in when persisting the owner fails", () =>
    Effect.gen(function* () {
      const failure = new AtomicFileStoreError({ reason: "disk full" });
      const cloud = fakeAuth();
      const sessionStore = memoryStore();
      const setup = ServerSetup.make({
        store: { ...memoryStore(), write: () => Effect.fail(failure) },
        auth: cloud.auth,
        sessions: ClientSessions.make(sessionStore),
      });
      const key = yield* keyOf(setup);
      yield* setup.start(key);
      cloud.approve("owner");
      assert.deepStrictEqual(yield* Effect.exit(setup.poll(key)), Exit.die(failure));
      assert.isNull(sessionStore.value);
      assert.deepStrictEqual(yield* setup.status, { ownerId: undefined, setupRequired: true });
    }),
  );
});
