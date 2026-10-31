import { CustomTypes } from "@macrograph/core";
import { expect, it } from "vitest";

import { referenceUrl } from "../../src/editor/inspector/referenceUrl";

it("links built-in module schemas to the macrograph publisher's reference", () => {
  expect(referenceUrl("twitch", { id: "ChatMessage" })).toBe(
    "https://macrograph.app/docs/macrograph/twitch/ChatMessage",
  );
});

it("links official registry modules by publisher and name", () => {
  expect(referenceUrl("macrograph.app/acme/lights", { id: "Toggle" })).toBe(
    "https://macrograph.app/docs/acme/lights/Toggle",
  );
});

it("has no reference for core packages, internal schemas, or other registries", () => {
  expect(referenceUrl(CustomTypes.packageId, { id: "MakeStruct" })).toBeUndefined();
  expect(referenceUrl("twitch", { id: "Helper", internal: true })).toBeUndefined();
  expect(referenceUrl("local/acme/lights", { id: "Toggle" })).toBeUndefined();
  expect(referenceUrl(undefined, { id: "ChatMessage" })).toBeUndefined();
});
