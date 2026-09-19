import { expect, it } from "vitest";

import { providerFromState } from "./credential-oauth-callback";

const encode = (value: string) =>
  btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

it("reads the provider from a signed-state payload", () => {
  expect(providerFromState(`${encode(JSON.stringify({ provider: "twitch" }))}.signature`)).toBe(
    "twitch",
  );
});

it("rejects malformed or missing provider state", () => {
  expect(providerFromState("not-base64.signature")).toBeUndefined();
  expect(
    providerFromState(`${encode(JSON.stringify({ provider: 1 }))}.signature`),
  ).toBeUndefined();
});
