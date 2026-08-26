import { assert, describe, it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Schema, Stream } from "effect";

import { Credential, Resource } from "../src/index.ts";

class AccountResource extends Resource.make<AccountResource, string>()("account", {
  name: "Account",
  description: "An authenticated account.",
}) {}

describe("Credential", () => {
  it.effect("decodes summaries produced before metadata and scopes were added", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(Credential.Summary)({
          provider: "twitch",
          id: "account",
          displayName: null,
          status: "available",
        }),
        {
          provider: "twitch",
          id: "account",
          displayName: null,
          status: "available",
          scopes: [],
          metadata: {},
        },
      );
    }),
  );
});

describe("Resource", () => {
  it.effect("uses distinct handler identities for resources with the same public key", () => {
    class OtherAccountResource extends Resource.make<OtherAccountResource, string>()("account", {
      name: "Other account",
    }) {}

    return Effect.gen(function* () {
      const first = yield* AccountResource.Handler;
      const second = yield* OtherAccountResource.Handler;
      assert.notStrictEqual(AccountResource.Handler.key, OtherAccountResource.Handler.key);
      assert.deepStrictEqual(yield* first.values, [{ id: "one", display: "One" }]);
      assert.deepStrictEqual(yield* second.values, [{ id: "two", display: "Two" }]);
    }).pipe(
      Effect.provide(
        Context.make(AccountResource.Handler, {
          tag: "account",
          values: Effect.succeed([{ id: "one", display: "One" }]),
          reload: Effect.void,
          changes: Stream.empty,
        }).pipe(
          Context.add(OtherAccountResource.Handler, {
            tag: "account",
            values: Effect.succeed([{ id: "two", display: "Two" }]),
            reload: Effect.void,
            changes: Stream.empty,
          }),
        ),
      ),
    );
  });

  it.effect("serializes concurrent reloads", () => {
    let active = 0;
    let maxActive = 0;
    return Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      let calls = 0;
      const load = Effect.gen(function* () {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        if (calls > 1) yield* Deferred.await(release);
        active--;
        return [{ id: String(calls), display: String(calls) }];
      });
      yield* Effect.gen(function* () {
        const first = yield* Effect.forkChild(AccountResource.reload);
        const second = yield* Effect.forkChild(AccountResource.reload);
        yield* Effect.yieldNow;
        assert.strictEqual(maxActive, 1);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
      }).pipe(Effect.provide(AccountResource.toLayer(load)));
      assert.strictEqual(maxActive, 1);
    });
  });

  it.effect("publishes metadata and reloads its live value stream", () => {
    let values = [{ id: "one", display: "One" }];
    return Effect.gen(function* () {
      const stream = yield* Effect.forkChild(
        AccountResource.changes.pipe(Stream.take(2), Stream.runCollect),
      );
      yield* Effect.yieldNow;

      assert.strictEqual(AccountResource.key, "account");
      assert.strictEqual(AccountResource.definition.name, "Account");
      assert.strictEqual(AccountResource.definition.description, "An authenticated account.");
      assert.deepStrictEqual(yield* AccountResource.values, values);

      values = [{ id: "two", display: "Two" }];
      yield* AccountResource.reload;
      assert.deepStrictEqual(Array.from(yield* Fiber.join(stream)), [
        [{ id: "one", display: "One" }],
        [{ id: "two", display: "Two" }],
      ]);
    }).pipe(Effect.provide(AccountResource.toLayer(Effect.sync(() => values))));
  });
});
