import { assert, describe, it } from "@effect/vitest";

import { describeFailure, RequestFailure } from "../src/Definition.ts";

describe("describeFailure", () => {
  it("keeps an existing request failure reason", () => {
    assert.strictEqual(
      describeFailure(new RequestFailure({ reason: "Unreachable" })),
      "Unreachable",
    );
  });

  it("keeps client error detail such as the HTTP status", () => {
    class ClientError extends Error {
      override name = "ClientError";
      reason = "UnexpectedStatus";
    }
    assert.strictEqual(
      describeFailure(new ClientError("UnexpectedStatus: 502")),
      "ClientError: UnexpectedStatus: 502",
    );
  });

  it("describes declared API errors with empty messages by tag and payload", () => {
    const declared = Object.assign(new Error(""), {
      _tag: "ProviderAuthError",
      data: { providerID: "anthropic" },
    });
    declared.name = "ProviderAuthError";
    assert.strictEqual(describeFailure(declared), 'ProviderAuthError: {"providerID":"anthropic"}');
    assert.strictEqual(
      describeFailure(
        Object.assign(new Error(""), { _tag: "NotFound", data: { message: "No model" } }),
      ),
      "NotFound: No model",
    );
  });

  it("falls back to a generic reason", () => {
    assert.strictEqual(describeFailure(new Error("")), "OpenCode request failed");
    assert.strictEqual(describeFailure(undefined), "OpenCode request failed");
    assert.strictEqual(describeFailure(new Error("boom")), "boom");
  });
});
