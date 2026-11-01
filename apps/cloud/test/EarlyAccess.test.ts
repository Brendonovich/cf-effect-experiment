import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Alchemy from "alchemy";
import { Effect } from "effect";

import * as EarlyAccess from "../src/EarlyAccess.ts";

const withDev = (dev: boolean) =>
  Effect.provideService(Alchemy.AlchemyContext, { dotAlchemy: ".alchemy", dev, adopt: false });

describe("early access allowlists", () => {
  afterEach(() => {
    delete process.env.TEST_ALLOWED_USERS;
  });

  it.effect("are the listed users when deploying", () =>
    Effect.gen(function* () {
      process.env.TEST_ALLOWED_USERS = " alice, ,bob ";
      assert.strictEqual(
        yield* EarlyAccess.allowedUsers("TEST_ALLOWED_USERS").pipe(withDev(false)),
        "alice,bob",
      );
      // Outside Alchemy, such as at runtime, nothing is added.
      assert.strictEqual(yield* EarlyAccess.allowedUsers("TEST_ALLOWED_USERS"), "alice,bob");
    }),
  );

  it.effect("include the dev account under alchemy dev", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* EarlyAccess.allowedUsers("TEST_ALLOWED_USERS").pipe(withDev(true)),
        EarlyAccess.devUserId,
      );
      process.env.TEST_ALLOWED_USERS = `alice,${EarlyAccess.devUserId}`;
      assert.strictEqual(
        yield* EarlyAccess.allowedUsers("TEST_ALLOWED_USERS").pipe(withDev(true)),
        `alice,${EarlyAccess.devUserId}`,
      );
    }),
  );
});
