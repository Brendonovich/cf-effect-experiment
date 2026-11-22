import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ModuleRegistry, ModuleTrust, StaticRegistry } from "../src/core.ts";
import { makeTestMounter } from "./helpers.ts";

const modules = [
  StaticRegistry.builtin({
    name: "alpha",
    displayName: "Alpha",
    description: "First",
    requires: ["http-client"],
    deployment: { tag: "alpha" },
  }),
  StaticRegistry.builtin({ name: "beta", displayName: "Beta", deployment: { tag: "beta" } }),
  StaticRegistry.builtin({
    name: "gamma",
    displayName: "Gamma",
    requires: ["file-system"],
    deployment: { tag: "gamma" },
  }),
];

describe("StaticRegistry", () => {
  it.effect("loads bundled modules through the registry without a filesystem", () => {
    const mounter = makeTestMounter();
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const catalog = yield* registry.catalog;
      assert.deepStrictEqual(
        catalog.map((entry) => [entry.id, entry.status, entry.displayName]),
        [
          ["macrograph.app/macrograph/alpha", "loaded", "Alpha"],
          ["macrograph.app/macrograph/beta", "loaded", "Beta"],
          ["macrograph.app/macrograph/gamma", "failed", "Gamma"],
        ],
      );
      assert.strictEqual(catalog[0]?.description, "First");
      assert.isUndefined(catalog[0]?.ui);
      assert.deepStrictEqual([...mounter.mounted.keys()].sort(), [
        "macrograph.app/macrograph/alpha",
        "macrograph.app/macrograph/beta",
      ]);

      const alpha = StaticRegistry.id(modules[0]!);
      yield* registry.reload(alpha);
      assert.deepStrictEqual(mounter.events.slice(-2), [`unmount ${alpha}`, `mount ${alpha}`]);
      yield* registry.unload(alpha);
      assert.isFalse(mounter.mounted.has(alpha));
      const notLoaded = yield* Effect.exit(registry.rpcHandler(alpha));
      assert.isTrue(Exit.isFailure(notLoaded));
      yield* registry.setEnabled(alpha, true);
      assert.isTrue(mounter.mounted.has(alpha));
      assert.isTrue(Option.isNone(yield* registry.staticFile(alpha, "ui", "x/index.js")));

      const link = yield* Effect.exit(registry.link(alpha, "/somewhere"));
      assert.isTrue(Exit.isFailure(link));
      const rescanned = yield* registry.rescan;
      assert.strictEqual(rescanned.size, 3);
    }).pipe(
      Effect.provide(
        StaticRegistry.layer({ modules, hostServices: ["http-client", "crypto"] }).pipe(
          Layer.provide([mounter.layer, ModuleTrust.none]),
        ),
      ),
    );
  });

  it("keeps the neutral entry free of Node built-ins", () => {
    const source = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
    const seen = new Set<string>();
    const external = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g)) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) visit(join(dirname(file), specifier));
        else external.add(specifier);
      }
    };
    visit(join(source, "core.ts"));
    assert.isFalse(seen.has(join(source, "ModuleRegistry.ts")));
    const forbidden = [...external].filter(
      (specifier) =>
        specifier.startsWith("node:") ||
        !(
          specifier === "effect" ||
          specifier.startsWith("effect/") ||
          specifier.startsWith("@macrograph/module/")
        ),
    );
    assert.deepStrictEqual(forbidden, []);
  });
});
