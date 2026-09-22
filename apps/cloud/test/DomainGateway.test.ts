import { assert, describe, it } from "@effect/vitest";

import gateway from "../src/worker/DomainGateway.ts";

describe("domain gateway", () => {
  for (const websocket of [false, true]) {
    it(`forwards ${websocket ? "WebSocket" : "HTTP"} requests and responses unchanged`, async () => {
      const request = new Request("https://cloud.macrograph.app/api/example?query=1", {
        method: websocket ? "GET" : "POST",
        headers: {
          origin: "https://cloud.macrograph.app",
          authorization: "Bearer example",
          ...(websocket ? { upgrade: "websocket" } : {}),
        },
        ...(websocket ? {} : { body: "request body" }),
      });
      const response = new Response("response body");
      const result = gateway.fetch(request, {
        CLOUD_WORKER: {
          async fetch(forwarded) {
            assert.strictEqual(forwarded, request);
            return response;
          },
        },
      });

      assert.strictEqual(await result, response);
      assert.isFalse(request.bodyUsed);
      assert.isFalse(response.bodyUsed);
    });
  }
});
