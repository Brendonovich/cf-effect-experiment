import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { ModuleRegistry } from "../src/ModuleRegistry.ts";
import {
  copyFixture,
  makeTestMounter,
  official,
  registryLayer,
  tempDir,
  versionedDir,
} from "./helpers.ts";

const loads = 20;

const alive = (refs: ReadonlyArray<WeakRef<object>>) =>
  refs.filter((ref) => ref.deref() !== undefined).length;

/**
 * Collection can lag behind a single gc() call (values still held by pending microtasks or the
 * current stack), so collect from a fresh macrotask and retry until settled.
 */
const collectGarbage = (refs: ReadonlyArray<WeakRef<object>>, keep: number) =>
  Effect.promise(async () => {
    const gc = globalThis.gc;
    if (gc === undefined) throw new Error("Run this test with --expose-gc");
    for (let attempt = 0; attempt < 50 && alive(refs) > keep; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      gc();
    }
  });

describe("garbage collection", () => {
  it.live("frees a module's server code after it unloads", () => {
    const shipped = tempDir();
    const id = official("gc");
    copyFixture("gc", versionedDir(shipped, id, "1.0.0"));
    const refs: Array<WeakRef<object>> = [];
    const mounter = makeTestMounter({
      onMount: (input) => {
        if (typeof input.deployment === "object" && input.deployment !== null)
          refs.push(new WeakRef(input.deployment));
      },
    });

    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      for (let index = 0; index < loads; index++) yield* registry.reload(id);
      assert.strictEqual(refs.length, loads + 1);

      // Sanity check that the test can see retention: the loaded copy must survive.
      yield* collectGarbage(refs, 1);
      assert.strictEqual(alive(refs), 1, "only the loaded copy should be alive");
      assert.isDefined(refs.at(-1)?.deref());

      yield* registry.unload(id);
      yield* collectGarbage(refs, 0);
      assert.strictEqual(alive(refs), 0, "every unloaded copy should be collected");
    }).pipe(Effect.provide(registryLayer({ shippedDirs: [shipped] }, mounter.layer)));
  });
});
