import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/module";
import { Effect, Layer, Result } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { SendblueEngine } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";

const setup = Effect.fnUntraced(function* (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
) {
  let storage: typeof SendblueEngine.Storage.Type = {
    accounts: {},
  };
  const context = Layer.succeed(SendblueEngine.EngineContext)(
    SendblueEngine.EngineContext.of({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) => Effect.sync(() => void (storage = value)),
        update: (update) => Effect.sync(() => void (storage = update(storage))),
      },
      resource: { refresh: () => Effect.void },
      credentials: {
        get: Effect.succeed([]),
        refresh: () => Effect.die("No credentials"),
        subscribe: () => Effect.void,
      },
      client: { refresh: Effect.void },
      emit: () => Effect.void,
    }),
  );
  const http = HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
  );
  return yield* EngineTest.makeClients(SendblueEngine).pipe(
    Effect.provide(deployment.layer),
    Effect.provide(context),
    Effect.provide(Layer.succeed(HttpClient.HttpClient)(http)),
  );
});

describe("Sendblue engine", () => {
  it.effect("sends a message with server-side credentials", () =>
    Effect.gen(function* () {
      const { client, runtime, engine } = yield* setup((request) => {
        assert.strictEqual(request.url, "https://api.sendblue.com/api/send-message");
        assert.strictEqual(request.headers["sb-api-key-id"], "key-id");
        assert.strictEqual(request.headers["sb-api-secret-key"], "secret-key");
        assert.strictEqual(request.body._tag, "Uint8Array");
        if (request.body._tag === "Uint8Array")
          assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(request.body.body)), {
            from_number: "+15125550100",
            number: "+15125550101",
            content: "Hello",
          });
        return Response.json({
          message_handle: "message-1",
          status: "QUEUED",
          service: "iMessage",
          was_downgraded: false,
        });
      });
      const accountId = yield* client.SendblueCreateAccount({
        name: "Primary",
        apiKey: "key-id",
        apiSecret: "secret-key",
        webhookSecret: "",
        mode: "polling",
      });
      assert.deepStrictEqual(yield* engine.client.state, {
        accounts: [{ id: accountId, name: "Primary", mode: "polling" }],
      });
      assert.deepStrictEqual(
        yield* runtime.SendblueSendMessage({
          accountId,
          fromNumber: "+15125550100",
          number: "+15125550101",
          content: "Hello",
          mediaUrl: "",
        }),
        {
          messageHandle: "message-1",
          status: "QUEUED",
          service: "iMessage",
          wasDowngraded: false,
        },
      );
    }),
  );

  it.effect("rejects invalid messages before contacting Sendblue", () =>
    Effect.gen(function* () {
      let calls = 0;
      const { client, runtime } = yield* setup(() => {
        calls++;
        return Response.json({});
      });
      const accountId = yield* client.SendblueCreateAccount({
        name: "Primary",
        apiKey: "key-id",
        apiSecret: "secret-key",
        webhookSecret: "webhook-secret",
        mode: "webhook",
      });
      const result = yield* Effect.result(
        runtime.SendblueSendMessage({
          accountId,
          fromNumber: "not-a-number",
          number: "+15125550101",
          content: "",
          mediaUrl: "",
        }),
      );
      assert.isTrue(Result.isFailure(result));
      assert.strictEqual(calls, 0);
    }),
  );
});
