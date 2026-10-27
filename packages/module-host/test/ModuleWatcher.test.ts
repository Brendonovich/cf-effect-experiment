import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Option, Stream } from "effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ModuleWatcher } from "../src/ModuleWatcher.ts";
import { tempDir } from "./helpers.ts";

describe("ModuleWatcher", () => {
  it.live("reports a folder that didn't exist when watching started, then its changes", () =>
    Effect.gen(function* () {
      const root = tempDir();
      const target = join(root, "modules", "local");
      const changes = yield* ModuleWatcher.watch([target], "50 millis").pipe(
        Stream.filter((changed) => changed.has(target)),
        Stream.take(2),
        Stream.runCollect,
        Effect.timeout("10 seconds"),
        Effect.forkChild,
      );
      yield* Effect.sleep("300 millis");
      mkdirSync(join(root, "modules"));
      yield* Effect.sleep("300 millis");
      mkdirSync(target);
      yield* Effect.sleep("300 millis");
      mkdirSync(join(target, "fixtures"));
      writeFileSync(join(target, "fixtures", "file.txt"), "changed");
      const collected = yield* Fiber.join(changes);
      assert.strictEqual(collected.length, 2);
      assert.isTrue(Option.isSome(Option.fromNullishOr(collected[0])));
    }),
  );
});
