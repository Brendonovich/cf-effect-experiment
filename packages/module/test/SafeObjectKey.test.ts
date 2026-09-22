import { describe, expect, it } from "vitest";

import { SafeObjectKey } from "../src/SafeObjectKey.ts";

describe("SafeObjectKey", () => {
  it("accepts ordinary keys", () => {
    expect(SafeObjectKey.make("node-id")).toBe("node-id");
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects %j", (key) => {
    expect(() => SafeObjectKey.make(key)).toThrow();
  });
});
