import { assert, describe, it } from "@effect/vitest";
import { Manifest } from "@macrograph/module/Manifest";
import * as ModuleIdModule from "@macrograph/module/ModuleId";
import * as effect from "effect";
import { Effect, Exit } from "effect";
import * as EffectModule from "effect/Effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { serverExcluded, specifiers } from "../scripts/shared-libraries.ts";
import { SharedLibraryTable } from "../src/SharedLibraryTable.ts";
import { VmLoader } from "../src/VmLoader.ts";
import { fixture, official } from "./helpers.ts";

const loadFixture = (name: string) =>
  Effect.gen(function* () {
    const root = fixture(name);
    const manifest = yield* Manifest.decodeJson(
      readFileSync(join(root, "macrograph.json"), "utf8"),
    );
    return yield* VmLoader.evaluate({ id: official(name), root, manifest });
  });

const failureMessage = (exit: Exit.Exit<unknown, unknown>) => {
  assert.isTrue(Exit.isFailure(exit));
  return Exit.isFailure(exit) ? String(exit.cause) : "";
};

const manifest = (node: ReadonlyArray<string> = []): Manifest.Model => ({
  manifest: 1,
  publisher: "fixtures",
  name: "inline",
  version: "1.0.0",
  api: 1,
  displayName: "Inline",
  server: "server.cjs",
  node,
});

describe("VmLoader", () => {
  it.effect("gives server entries the host's own shared library instances", () =>
    Effect.gen(function* () {
      const deployment = yield* loadFixture("effect-check");
      assert.isTrue(typeof deployment === "object" && deployment !== null);
      if (typeof deployment !== "object" || deployment === null) return;
      assert.strictEqual(Reflect.get(deployment, "Effect"), EffectModule);
      assert.strictEqual(Reflect.get(deployment, "effect"), effect);
      assert.strictEqual(Reflect.get(deployment, "ModuleId"), ModuleIdModule);
      const program = Reflect.get(deployment, "program");
      // The fixture built this with the host's Effect, so the host's runtime can run it.
      const isEffect = (value: unknown): value is Effect.Effect<unknown> => Effect.isEffect(value);
      assert.isTrue(isEffect(program));
      if (isEffect(program)) assert.strictEqual(yield* program, 42);
    }),
  );

  it.effect("rejects modules outside the shared libraries", () =>
    Effect.gen(function* () {
      const message = failureMessage(yield* Effect.exit(loadFixture("disallowed")));
      assert.include(message, 'cannot require "lodash"');
    }),
  );

  it.effect("allows declared node built-ins and rejects undeclared ones", () =>
    Effect.gen(function* () {
      const deployment = yield* loadFixture("node-builtin");
      assert.deepStrictEqual(deployment, { kind: "node-builtin", joined: "a/b" });
      const message = failureMessage(yield* Effect.exit(loadFixture("undeclared-builtin")));
      assert.include(message, `"node:fs" is a Node built-in the manifest doesn't declare`);
    }),
  );

  it("resolves bare built-in names through the node allowlist", () => {
    const value = VmLoader.evaluateSource(
      official("inline"),
      manifest(["path"]),
      'exports.default = require("path").posix.join("x", "y");',
      "/virtual/server.cjs",
    );
    assert.strictEqual(value, "x/y");
  });

  it("rejects shared specifiers the host doesn't export", () => {
    assert.throws(
      () =>
        VmLoader.evaluateSource(
          official("inline"),
          manifest(),
          'require("effect/internal/core");',
          "/virtual/server.cjs",
        ),
      /not exported by the host's shared libraries/,
    );
    assert.throws(
      () =>
        VmLoader.evaluateSource(
          official("inline"),
          manifest(),
          'require("@macrograph/module/vite");',
          "/virtual/server.cjs",
        ),
      /not exported by the host's shared libraries/,
    );
  });

  it("reads module.exports when there is no default export", () => {
    const value = VmLoader.evaluateSource(
      official("inline"),
      manifest(),
      "module.exports = { plain: true };",
      "/virtual/server.cjs",
    );
    assert.deepStrictEqual(value, { plain: true });
  });

  it.effect("reports evaluation errors with the real file path", () =>
    Effect.gen(function* () {
      const message = failureMessage(yield* Effect.exit(loadFixture("throws")));
      assert.include(message, "fixture exploded during evaluation");
      assert.include(message, join(fixture("throws"), "server.cjs"));
    }),
  );
});

describe("SharedLibraryTable", () => {
  it("is up to date with SharedLibraries.server and the shared packages' exports", () => {
    // Compare specifiers rather than text: the committed file is run through the formatter.
    assert.deepStrictEqual([...SharedLibraryTable.specifiers].sort(), [...specifiers()]);
  });

  it("maps specifiers to the modules the host imports", () => {
    assert.isTrue(SharedLibraryTable.specifiers.includes("effect"));
    assert.isTrue(SharedLibraryTable.specifiers.includes("effect/Schema"));
    assert.isTrue(SharedLibraryTable.specifiers.includes("effect/rpc/RpcServer"));
    assert.isFalse(SharedLibraryTable.specifiers.includes("effect/internal/core"));
    for (const excluded of serverExcluded)
      assert.isFalse(SharedLibraryTable.specifiers.includes(excluded));
    assert.strictEqual(
      effect.Option.getOrUndefined(SharedLibraryTable.resolve("effect/Effect")),
      EffectModule,
    );
    assert.isTrue(effect.Option.isNone(SharedLibraryTable.resolve("lodash")));
  });
});
