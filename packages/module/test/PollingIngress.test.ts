import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import * as PollingIngress from "../src/PollingIngress.ts";

describe("PollingIngress", () => {
  const Event = Schema.Struct({ _tag: Schema.Literal("ItemReceived"), value: Schema.String });
  const handler = PollingIngress.make({
    id: "test:items",
    displayName: "Items",
    intervalMs: 1_000,
    configuration: Schema.Struct({ token: Schema.String }),
    cursor: Schema.Struct({ offset: Schema.Number }),
    event: Event,
    initialCursor: () => Effect.succeed({ offset: 0 }),
    poll: ({ cursor }) =>
      Effect.succeed({
        cursor: { offset: cursor.offset + 1 },
        events: [{ event: { _tag: "ItemReceived" as const, value: "hello" }, eventId: "1" }],
      }),
  });

  it.effect("decodes requirements, advances cursors and encodes events", () =>
    Effect.gen(function* () {
      const requirement = handler.require({
        instanceKey: "account-1",
        configuration: { token: "secret" },
      });
      assert.strictEqual(requirement.intervalMs, 1_000);
      assert.deepStrictEqual(yield* handler.initialCursor(requirement.configuration), {
        offset: 0,
      });
      assert.deepStrictEqual(yield* handler.poll(requirement.configuration, { offset: 0 }), {
        cursor: { offset: 1 },
        events: [
          {
            eventType: "ItemReceived",
            eventId: "1",
            payload: { _tag: "ItemReceived", value: "hello" },
          },
        ],
      });
    }),
  );

  it.effect("rejects invalid persisted configuration and cursors", () =>
    Effect.gen(function* () {
      assert.isTrue(Result.isFailure(yield* Effect.result(handler.initialCursor({ token: 1 }))));
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(handler.poll({ token: "secret" }, { offset: "invalid" })),
        ),
      );
    }),
  );
});
