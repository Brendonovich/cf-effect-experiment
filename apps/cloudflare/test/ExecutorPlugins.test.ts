import { assert, describe, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { unavailableRuntimeClient as unavailableTwitchRuntimeClient } from "@macrograph/plugin-twitch/Engine";
import { ProjectExecutor } from "@macrograph/project-host";
import { Effect } from "effect";

import * as ExecutorPlugins from "../src/execution/ExecutorPlugins.ts";

describe("ExecutorPlugins", () => {
  it("does not register WebSocket-only OBS", () => {
    assert.isFalse(ExecutorPlugins.registry.entries.some(({ id }) => id === "obs"));
  });

  it.effect("registers Twitch metadata with credential-owned workflow execution", () =>
    Effect.gen(function* () {
      assert.isTrue(ExecutorPlugins.registry.entries.some(({ id }) => id === "twitch"));
      const failure = yield* Effect.flip(unavailableTwitchRuntimeClient.SendChatMessage());
      assert.strictEqual(failure._tag, "TwitchExecutionUnavailable");
      assert.include(failure.reason, "no credential-scoped workflow RPC binding exists");
    }),
  );

  it.effect("decodes and dispatches a Ko-fi payment", () =>
    Effect.gen(function* () {
      const executor = yield* ProjectExecutor.make(Project.empty(), {
        plugins: ExecutorPlugins.registry,
      });
      yield* ExecutorPlugins.registry.handle(executor, "kofi", {
        _tag: "Donation",
        webhookId: "primary",
        message_id: "message-1",
        timestamp: "2026-08-21T10:00:00Z",
        is_public: true,
        from_name: "A Supporter",
        message: "Keep going!",
        amount: "5.00",
        url: "https://ko-fi.com/",
        email: "supporter@example.com",
        currency: "USD",
        is_subscription_payment: false,
        is_first_subscription_payment: false,
        kofi_transaction_id: "transaction-1",
      });
    }),
  );
});
