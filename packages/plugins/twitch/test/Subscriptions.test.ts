import type { Credential } from "@macrograph/plugin/Engine";

import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, HashMap, Layer, Redacted, Result } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import type { Make as MakeEventSub, State } from "../src/EventSubImplementation.ts";

import { AccountId, TwitchEngine } from "../src/Definition.ts";
import { make } from "../src/Engine.ts";
import { Helix } from "../src/Helix.ts";

const accountId = AccountId.make("account-1");

const setup = Effect.fnUntraced(function* (
  state: State,
  reconcileResult: Effect.Effect<void, Helix.HelixError> = Effect.void,
) {
  let storage: typeof TwitchEngine.Storage.Type = {
    accounts: { [accountId]: { enabled: true, subscriptions: [] } },
  };
  const credential: Credential = {
    id: accountId,
    provider: "twitch",
    token: { access: Redacted.make("test-token") },
  };
  const reconciliations: Array<{ accountId: AccountId; subscriptions: ReadonlyArray<string> }> = [];
  const fakeMakeEventSub: MakeEventSub = (context) =>
    Effect.succeed({
      transport: "websocket",
      state: Effect.succeed(HashMap.make([accountId, { state }])),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      reconcile: (id) =>
        Effect.gen(function* () {
          const subscriptions = yield* context.getSubscriptions(id);
          reconciliations.push({ accountId: id, subscriptions });
          yield* reconcileResult;
        }),
    });
  const httpClient = HttpClient.make((request) =>
    Effect.sync(() => {
      assert.strictEqual(request.url, "https://id.twitch.tv/oauth2/validate");
      return HttpClientResponse.fromWeb(
        request,
        new Response(
          JSON.stringify({ user_id: accountId, client_id: Helix.DEFAULT_CLIENT_ID, scopes: [] }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }),
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient)(httpClient),
    Layer.succeed(TwitchEngine.EngineContext)({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) =>
          Effect.sync(() => {
            storage = value;
          }),
        update: (f) =>
          Effect.sync(() => {
            storage = f(storage);
          }),
      },
      resource: { refresh: () => Effect.void },
      client: { refresh: Effect.void },
      emit: () => Effect.void,
      credentials: {
        get: Effect.succeed([credential]),
        refresh: () => Effect.succeed(credential),
        subscribe: () => Effect.void,
      },
    }),
  );
  const { client } = yield* EngineTest.makeClients(TwitchEngine).pipe(
    Effect.provide(make(fakeMakeEventSub).pipe(Layer.provide(dependencies))),
  );
  return {
    reconciliations,
    storage: () => storage,
    toggle: client.ToggleEventSubSubscription({
      accountId,
      subscriptionType: "channel.ban",
      enabled: true,
    }),
  };
});

describe("ToggleEventSubSubscription", () => {
  it.effect("requests reconciliation for an enabled websocket account while connecting", () =>
    Effect.gen(function* () {
      const test = yield* setup("connecting");
      yield* test.toggle;
      assert.deepStrictEqual(test.storage().accounts[accountId], {
        enabled: true,
        subscriptions: ["channel.ban"],
      });
      assert.deepStrictEqual(test.reconciliations, [{ accountId, subscriptions: ["channel.ban"] }]);
    }),
  );

  it.effect("propagates HelixError from reconciliation", () =>
    Effect.gen(function* () {
      const error = new Helix.HelixError({ reason: "Subscription limit exceeded", status: 429 });
      const test = yield* setup("connected", Effect.fail(error));
      const result = yield* Effect.result(test.toggle);
      assert.deepStrictEqual(test.reconciliations, [{ accountId, subscriptions: ["channel.ban"] }]);
      assert(Result.isFailure(result));
      assert.deepStrictEqual(result.failure, error);
    }),
  );
});
