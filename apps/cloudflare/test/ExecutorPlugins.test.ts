import { describe, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { ProjectExecutor } from "@macrograph/project-host";
import { Effect } from "effect";

import * as ExecutorPlugins from "../src/runtime/ExecutorPlugins.ts";

describe("ExecutorPlugins", () => {
  it.effect("decodes and dispatches a Ko-fi payment", () =>
    Effect.gen(function* () {
      const executor = yield* ProjectExecutor.make(Project.empty(), {
        plugins: ExecutorPlugins.registry,
      });
      yield* ExecutorPlugins.registry.handle(executor, "kofi", {
        _tag: "Donation",
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
