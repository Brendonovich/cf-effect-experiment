import { describe, expect, it } from "vitest";

import { safeNextPath, toCredentialSummary } from "./api";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/account/servers?tab=1")).toBe("/account/servers?tab=1");
  });

  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example"])(
    "falls back to the home page for %s",
    (next) => {
      expect(safeNextPath(next)).toBe("/");
    },
  );
});

it("maps website credentials to the shared credential summary", () => {
  expect(
    toCredentialSummary({ providerId: "twitch", providerUserId: "123", displayName: "Ada" }),
  ).toEqual({
    provider: "twitch",
    id: "123",
    displayName: "Ada",
    status: "available",
    scopes: [],
    metadata: {},
  });
});
