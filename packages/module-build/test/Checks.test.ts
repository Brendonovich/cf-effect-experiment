import { Manifest } from "@macrograph/module/Manifest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Cause, Effect, Exit } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rolldown } from "rolldown";
import { afterAll, describe, expect, it } from "vitest";

import { Build } from "../src/Build.ts";
import { Checks } from "../src/Checks.ts";

const fixtures = resolve(import.meta.dirname, "fixtures");
const outRoot = mkdtempSync(join(tmpdir(), "macrograph-module-checks-"));
afterAll(() => rmSync(outRoot, { recursive: true, force: true }));

const manifest = (overrides: Partial<Manifest.Model> = {}): Manifest.Model => ({
  manifest: Manifest.FormatVersion,
  publisher: "fixture",
  name: "fixture",
  version: "0.1.0",
  api: Manifest.ApiVersion,
  displayName: "Fixture",
  server: ModulePackage.ServerEntry,
  ...overrides,
});

const manifestFile = (value: Manifest.Model): Checks.File => ({
  path: ModulePackage.ManifestFile,
  contents: JSON.stringify(value),
});

const codes = (issues: ReadonlyArray<Checks.Issue>) =>
  Checks.errors(issues).map((issue) => issue.code);

/** Bundles a fixture with nothing external, the way a misconfigured build would. */
const bundleWithoutExternals = async (entry: string) => {
  const bundle = await rolldown({ input: entry, platform: "node", logLevel: "silent" });
  try {
    const output = await bundle.generate({ format: "cjs", codeSplitting: false, exports: "named" });
    const chunk = output.output[0];
    return { code: chunk.code, moduleIds: chunk.moduleIds };
  } finally {
    await bundle.close();
  }
};

describe("shared library copies", () => {
  it("rejects a package whose server bundle contains Effect", async () => {
    const { code } = await bundleWithoutExternals(join(fixtures, "bundled-effect/src/Module.ts"));
    const { issues } = Checks.checkPackage([
      manifestFile(manifest()),
      { path: ModulePackage.ServerEntry, contents: code },
    ]);
    expect(codes(issues)).toContain("shared-library-copy");
    expect(issues.find((issue) => issue.code === "shared-library-copy")?.message).toContain(
      "effect",
    );
  });

  it("detects Effect in the bundle graph", async () => {
    const { moduleIds } = await bundleWithoutExternals(
      join(fixtures, "bundled-effect/src/Module.ts"),
    );
    const issues = Checks.sharedLibraryCopies(
      moduleIds.map((id) => ({ id, packageName: Checks.packageFromPath(id) })),
      "server",
    );
    expect(codes(issues)).toEqual(["shared-library-copy"]);
  });

  it("detects Effect from its signature when region markers are stripped", () => {
    const code = 'var TypeId = "~effect/Effect";\nexports.default = {};';
    expect(codes(Checks.checkServerEntry(code))).toContain("shared-library-copy");
  });

  it("detects bundled browser libraries in UI chunks", () => {
    const code =
      "//#region ../../node_modules/solid-js/dist/solid.js\nexport const x = 1;\n//#endregion\n";
    expect(codes(Checks.checkUiChunk(code, "ui/index.js"))).toEqual(["shared-library-copy"]);
  });

  it("accepts the preset's own output", async () => {
    const result = await Effect.runPromise(
      Build.build({
        packageDirectory: join(fixtures, "bundled-effect"),
        outDirectory: join(outRoot, "bundled-effect"),
      }),
    );
    expect(Checks.errors(result.issues)).toEqual([]);
  });
});

describe("top-level await", () => {
  it("rejects top-level await in a server entry", () => {
    const code = "const value = await Promise.resolve(1);\nexports.default = value;";
    expect(codes(Checks.checkServerEntry(code))).toEqual(["top-level-await"]);
  });

  it("allows await inside functions", () => {
    const code = "exports.default = async () => { await Promise.resolve(1); };";
    expect(Checks.checkServerEntry(code)).toEqual([]);
  });

  it("fails to build a module that uses top-level await", async () => {
    const exit = await Effect.runPromiseExit(
      Build.build({ packageDirectory: join(fixtures, "tla"), outDirectory: join(outRoot, "tla") }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(Build.BuildError);
      expect(error instanceof Build.BuildError ? error.issues : []).toEqual([
        expect.objectContaining({ code: "top-level-await" }),
      ]);
    }
  });
});

describe("requires", () => {
  it("rejects requires the host can't resolve", () => {
    const code = 'const ws = require("ws");\nexports.default = ws;';
    expect(codes(Checks.checkServerEntry(code))).toEqual(["unresolvable-require"]);
  });

  it("allows declared externals", () => {
    const code = 'const midi = require("@julusian/midi");\nexports.default = midi;';
    expect(Checks.checkServerEntry(code, { external: ["@julusian/midi"] })).toEqual([]);
  });

  it("requires node built-ins to be declared", () => {
    const code = 'const fs = require("node:fs");\nconst Effect = require("effect/Effect");';
    expect(codes(Checks.checkServerEntry(code, { manifest: manifest() }))).toEqual([
      "undeclared-node-builtin",
    ]);
    expect(Checks.checkServerEntry(code, { manifest: manifest({ node: ["fs"] }) })).toEqual([]);
  });

  it("rejects bare imports of unshared libraries in UI chunks", () => {
    const code =
      'import { x } from "lodash";\nimport { Effect } from "effect";\nimport "./chunk.js";';
    expect(codes(Checks.checkUiChunk(code, "ui/index.js"))).toEqual(["unshared-import"]);
  });
});

describe("package layout and limits", () => {
  const server = { path: ModulePackage.ServerEntry, contents: "exports.default = {};" };

  it("reports missing files referenced by the manifest", () => {
    const { issues } = Checks.checkPackage([
      manifestFile(
        manifest({ ui: { entry: ModulePackage.UiEntry, styles: [ModulePackage.UiStyles] } }),
      ),
      server,
    ]);
    expect(codes(issues)).toEqual(["missing-file", "missing-file"]);
  });

  it("rejects files outside the layout and invalid manifests", () => {
    const { issues } = Checks.checkPackage([
      { path: ModulePackage.ManifestFile, contents: JSON.stringify({ name: "fixture" }) },
      server,
      { path: "secrets.txt", contents: "" },
    ]);
    expect(codes(issues)).toEqual(expect.arrayContaining(["invalid-manifest", "unexpected-file"]));
  });

  it("enforces size limits", () => {
    const { issues } = Checks.checkPackage([manifestFile(manifest()), server], {
      limits: { serverBytes: 4 },
    });
    expect(codes(issues)).toEqual(["size-limit"]);
  });

  it("rejects unsupported api versions", () => {
    const { issues } = Checks.checkPackage([manifestFile(manifest({ api: 2 })), server], {
      supportedApis: [1],
    });
    expect(codes(issues)).toEqual(["invalid-manifest"]);
  });
});
