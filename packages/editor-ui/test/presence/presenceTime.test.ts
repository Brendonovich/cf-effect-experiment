import { expect, it } from "vitest";

import { formatLastActive, presenceOpacity } from "../../src/presence/presenceTime";

it("describes how long ago a client was active", () => {
  expect(formatLastActive(-500)).toBe("just now");
  expect(formatLastActive(4_999)).toBe("just now");
  expect(formatLastActive(12_400)).toBe("12s ago");
  expect(formatLastActive(125_000)).toBe("2m ago");
  expect(formatLastActive(2 * 60 * 60_000)).toBe("2h ago");
});

it("fades touched clients over the last third of their lifetime", () => {
  const touched = { lastActiveAt: 0, expiresAt: 90_000 };
  const opacity = presenceOpacity;
  expect(opacity({ lastActiveAt: 0, expiresAt: null }, 1e9)).toBe(1);
  expect(opacity(touched, 30_000)).toBe(1);
  expect(opacity(touched, 60_000)).toBe(1);
  expect(opacity(touched, 75_000)).toBeCloseTo(0.7);
  expect(opacity(touched, 90_000)).toBeCloseTo(0.4);
  expect(opacity(touched, 120_000)).toBeCloseTo(0.4);
});
