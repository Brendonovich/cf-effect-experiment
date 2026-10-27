import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { HostService, Manifest, SharedLibraries } from "../src/index.ts";

const valid = {
  manifest: Manifest.FormatVersion,
  publisher: "macrograph",
  name: "twitch",
  version: "1.2.3-beta.1+build.5",
  api: Manifest.ApiVersion,
  displayName: "Twitch",
  description: "Twitch nodes",
  server: "server.cjs",
  ui: { entry: "ui/index.js", styles: ["ui/styles.css"] },
  icon: "assets/icon.svg",
  requires: ["http-client", "credentials"],
  node: ["fs", "fs/promises"],
} as const;

const decode = (value: unknown) => Effect.runSync(Effect.exit(Manifest.decode(value)));

describe("Manifest", () => {
  it("decodes a full manifest and a minimal one", () => {
    const full = decode(valid);
    assert.isTrue(Exit.isSuccess(full));
    if (Exit.isSuccess(full)) assert.deepStrictEqual(full.value, valid);

    const minimal = {
      manifest: 1,
      publisher: "alice",
      name: "foo",
      version: "0.1.0",
      api: 1,
      displayName: "Foo",
      server: "server.cjs",
    };
    assert.isTrue(Exit.isSuccess(decode(minimal)));
  });

  it("decodes from JSON text", () => {
    const exit = Effect.runSync(Effect.exit(Manifest.decodeJson(JSON.stringify(valid))));
    assert.isTrue(Exit.isSuccess(exit));
  });

  it("rejects invalid fields", () => {
    for (const [field, value] of [
      ["manifest", 2],
      ["publisher", "Mac"],
      ["name", "foo_bar"],
      ["version", "1.0"],
      ["version", "latest"],
      ["api", 1.5],
      ["api", 0],
      ["displayName", ""],
      ["server", "/abs/server.cjs"],
      ["server", "../server.cjs"],
      ["server", "dist\\server.cjs"],
      ["ui", { entry: "ui/./index.js", styles: [] }],
      ["ui", { entry: "ui/index.js" }],
      ["icon", "assets/../../icon.svg"],
      ["requires", ["gpu"]],
      ["node", ["node:fs"]],
    ] as const)
      assert.isTrue(Exit.isFailure(decode({ ...valid, [field]: value })), `${field}: ${value}`);

    const { server: _, ...missingServer } = valid;
    assert.isTrue(Exit.isFailure(decode(missingServer)));
  });

  it("derives the module id from the namespace it loads under", () => {
    const manifest = Effect.runSync(Manifest.decode(valid));
    assert.strictEqual(Manifest.moduleId(manifest, "local"), "local/macrograph/twitch");
  });

  it("allows only declared node built-ins", () => {
    const manifest = Effect.runSync(Manifest.decode(valid));
    assert.isTrue(Manifest.allowsNodeBuiltin(manifest, "node:fs"));
    assert.isTrue(Manifest.allowsNodeBuiltin(manifest, "node:fs/promises"));
    assert.isFalse(Manifest.allowsNodeBuiltin(manifest, "node:net"));
    assert.isFalse(Manifest.allowsNodeBuiltin(manifest, "fs"));
  });
});

describe("HostService", () => {
  it("reports required services the host does not offer", () => {
    assert.deepStrictEqual(
      HostService.missing(["http-client", "socket", "crypto"], ["http-client", "crypto"]),
      ["socket"],
    );
    assert.isTrue(HostService.is("file-system"));
    assert.isFalse(HostService.is("gpu"));
  });
});

describe("SharedLibraries", () => {
  it("matches shared specifiers per target", () => {
    for (const specifier of ["effect", "effect/Schema", "@macrograph/module/Engine"]) {
      assert.isTrue(SharedLibraries.isShared(specifier, "server"), specifier);
      assert.isTrue(SharedLibraries.isShared(specifier, "browser"), specifier);
    }
    for (const specifier of ["solid-js", "solid-js/store", "@macrograph/editor-ui/tokens.stylex"]) {
      assert.isTrue(SharedLibraries.isShared(specifier, "browser"), specifier);
      assert.isFalse(SharedLibraries.isShared(specifier, "server"), specifier);
    }
    for (const specifier of ["effect-x", "effectful", "@macrograph/modules", "zod", "effect/"])
      assert.isFalse(SharedLibraries.isShared(specifier, "server"), specifier);
    assert.isTrue(SharedLibraries.isShared("@macrograph/module/vite", "server"));
    assert.isFalse(SharedLibraries.isShared("@macrograph/module/vite", "browser"));
    assert.isTrue(SharedLibraries.isShared("@tanstack/solid-query", "browser"));
    assert.isFalse(SharedLibraries.isShared("@tanstack/solid-query/build", "browser"));
  });

  it("resolves package names", () => {
    assert.strictEqual(SharedLibraries.packageName("effect/Schema"), "effect");
    assert.strictEqual(
      SharedLibraries.packageName("@macrograph/module/Engine"),
      "@macrograph/module",
    );
  });
});
