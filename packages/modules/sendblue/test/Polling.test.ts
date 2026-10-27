import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { AccountId } from "../src/Definition.ts";
import { handler, requirements } from "../src/Polling.ts";

describe("Sendblue polling ingress", () => {
  it.effect("is enabled only when polling mode is selected", () =>
    Effect.gen(function* () {
      const storage = {
        accounts: {
          primary: {
            name: "Primary",
            apiKey: "key-id",
            apiSecret: "secret-key",
            webhookSecret: null,
            mode: "polling" as const,
          },
        },
      };
      assert.strictEqual((yield* requirements(storage)).length, 1);
      assert.deepStrictEqual(
        yield* requirements({
          accounts: { primary: { ...storage.accounts.primary, mode: "webhook" } },
        }),
        [],
      );
    }),
  );

  it.effect("polls inbound messages and advances a deduplicating cursor", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) => {
        const url = new URL(request.url);
        assert.strictEqual(url.pathname, "/api/v2/messages");
        assert.strictEqual(url.searchParams.get("is_outbound"), "false");
        assert.strictEqual(url.searchParams.get("limit"), "100");
        assert.strictEqual(request.headers["sb-api-key-id"], "key-id");
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              data: [
                {
                  message_handle: "old",
                  from_number: "+15125550101",
                  to_number: "+15125550100",
                  content: "Already seen",
                  date_sent: "2026-10-13T10:00:00Z",
                  date_updated: "2026-10-13T10:00:00Z",
                },
                {
                  message_handle: "new",
                  from_number: "+15125550101",
                  to_number: "+15125550100",
                  content: "Hello",
                  service: "iMessage",
                  date_sent: "2026-10-13T10:00:01Z",
                  date_updated: "2026-10-13T10:00:01Z",
                },
              ],
            }),
          ),
        );
      });
      const result = yield* handler
        .poll(
          { accountId: AccountId.make("primary"), apiKey: "key-id", apiSecret: "secret-key" },
          { sentAt: "2026-10-13T10:00:00Z", handles: ["old"] },
        )
        .pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient)(http)));
      assert.deepStrictEqual(result.cursor, {
        sentAt: "2026-10-13T10:00:01Z",
        handles: ["new"],
      });
      assert.strictEqual(result.events.length, 1);
      assert.deepInclude(result.events[0], {
        eventType: "SendblueMessageReceived",
        eventId: "new",
      });
      assert.deepInclude(result.events[0]?.payload, { accountId: "primary" });
    }),
  );
});
