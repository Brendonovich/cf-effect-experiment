import { strict as assert } from "node:assert";
import { it } from "vitest";

import { providerFromState } from "./credential-oauth-callback";

const encode = (value: string) =>
  btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

it("reads the provider from a signed-state payload", () => {
  assert.equal(
    providerFromState(`${encode(JSON.stringify({ provider: "twitch" }))}.signature`),
    "twitch",
  );
});

it("rejects malformed or missing provider state", () => {
  assert.equal(providerFromState("not-base64.signature"), undefined);
  assert.equal(
    providerFromState(`${encode(JSON.stringify({ provider: 1 }))}.signature`),
    undefined,
  );
});
