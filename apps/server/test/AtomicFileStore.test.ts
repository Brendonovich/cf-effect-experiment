import { Effect } from "effect";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeAtomicFileStore } from "../src/AtomicFileStore.ts";

describe("protected server file stores", () => {
  it("atomically persists mode-0600 values across store instances", async () => {
    const directory = mkdtempSync(join(tmpdir(), "macrograph-store-"));
    const path = join(directory, "nested", "auth.json");
    const first = makeAtomicFileStore(path);
    await Effect.runPromise(first.write("session-secret"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "nested")).mode & 0o777).toBe(0o700);
    expect(readFileSync(path, "utf8")).toBe("session-secret");
    expect(await Effect.runPromise(makeAtomicFileStore(path).read)).toBe("session-secret");
    await Effect.runPromise(first.clear);
    expect(await Effect.runPromise(first.read)).toBeNull();
  });
});
