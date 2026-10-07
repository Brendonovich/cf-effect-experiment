import { expect, it } from "@effect/vitest";

import { randomUUID } from "../src/Uuid.ts";

it("generates unique RFC 4122 version 4 UUIDs", () => {
  const ids = Array.from({ length: 1000 }, randomUUID);
  for (const id of ids)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(ids).size).toBe(ids.length);
});
