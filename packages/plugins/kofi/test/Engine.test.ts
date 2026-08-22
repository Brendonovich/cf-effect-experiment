import { assert, describe, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, Layer } from "effect";

import { KofiEngine } from "../src/Definition.ts";
import deployment from "../src/Deployment/Webhook.ts";

describe("KofiEngine", () => {
  it.effect("creates and removes persisted webhooks", () =>
    Effect.gen(function* () {
      let storage: typeof KofiEngine.Storage.Type = { webhooks: {} };
      const refresh = vi.fn();
      const context = Layer.succeed(
        KofiEngine.EngineContext,
        KofiEngine.EngineContext.of({
          storage: {
            get: Effect.sync(() => storage),
            set: (value) => Effect.sync(() => void (storage = value)),
            update: (f) => Effect.sync(() => void (storage = f(storage))),
          },
          resource: { refresh: () => Effect.void },
          credentials: {
            get: Effect.succeed([]),
            refresh: () => Effect.die("No credentials"),
            subscribe: () => Effect.void,
          },
          client: { refresh: Effect.sync(refresh) },
          emit: () => Effect.void,
        }),
      );
      const { engine, client } = yield* EngineTest.makeClients(KofiEngine).pipe(
        Effect.provide(deployment.layer),
        Effect.provide(context),
      );

      const webhookId = yield* client.KofiCreateWebhook({ verificationToken: "secret" });
      assert.isTrue(webhookId.length > 0);
      assert.deepStrictEqual(storage, {
        webhooks: { [webhookId]: { verificationToken: "secret" } },
      });
      assert.deepStrictEqual(yield* engine.client.state, {
        webhooks: [{ id: webhookId }],
      });

      yield* client.KofiRemoveWebhook({ webhookId });
      assert.deepStrictEqual(storage, { webhooks: {} });
      assert.strictEqual(refresh.mock.calls.length, 2);
    }),
  );
});
