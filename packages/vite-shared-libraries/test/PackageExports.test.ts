import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PackageExports } from "../src/PackageExports.ts";
import { expand } from "../src/SharedLibrariesPlugin.ts";

const fixturePackage = (json: object, fileList: ReadonlyArray<string>) => {
  const directory = mkdtempSync(join(tmpdir(), "macrograph-exports-"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "fixture", ...json }));
  for (const file of fileList) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), "");
  }
  const pkg = PackageExports.read(directory);
  if (pkg === undefined) throw new Error("fixture package missing");
  return pkg;
};

describe("PackageExports", () => {
  it("expands wildcard exports against files and skips internals and non-scripts", () => {
    const pkg = fixturePackage(
      {
        exports: {
          ".": "./dist/index.js",
          "./package.json": "./package.json",
          "./styles.css": "./dist/styles.css",
          "./*": "./dist/*.js",
          "./internal/*": "./dist/internal/*.js",
          "./blocked": null,
          "./server": { node: "./dist/server.js" },
          "./types-only": { types: "./dist/types.d.ts" },
        },
      },
      [
        "dist/index.js",
        "dist/Schema.js",
        "dist/http/index.js",
        "dist/internal/core.js",
        "dist/styles.css",
        "dist/server.js",
        "dist/Schema.d.ts",
      ],
    );
    expect(PackageExports.subpaths(pkg)).toEqual([".", "./Schema", "./http/index", "./index"]);
  });

  it("follows conditions in object order", () => {
    const pkg = fixturePackage(
      {
        exports: {
          ".": {
            node: "./dist/server.js",
            browser: { development: "./dist/dev.js", default: "./dist/browser.js" },
            default: "./dist/server.js",
          },
        },
      },
      ["dist/server.js", "dist/dev.js", "dist/browser.js"],
    );
    expect(PackageExports.resolveSubpath(pkg, ".")).toBe(join(pkg.directory, "dist/browser.js"));
    expect(PackageExports.resolveSubpath(pkg, ".", ["node"])).toBe(
      join(pkg.directory, "dist/server.js"),
    );
  });

  it("maps files back to their public specifiers", () => {
    const pkg = fixturePackage(
      { exports: { "./tokens.stylex": "./src/tokens.stylex.ts", "./ui/*": "./src/ui/*.tsx" } },
      ["src/tokens.stylex.ts", "src/ui/Button.tsx", "src/other.ts"],
    );
    expect(PackageExports.specifierForFile(pkg, join(pkg.directory, "src/tokens.stylex.ts"))).toBe(
      "fixture/tokens.stylex",
    );
    expect(PackageExports.specifierForFile(pkg, join(pkg.directory, "src/ui/Button.tsx"))).toBe(
      "fixture/ui/Button",
    );
    expect(
      PackageExports.specifierForFile(pkg, join(pkg.directory, "src/other.ts")),
    ).toBeUndefined();
  });
});

describe("expand", () => {
  const client = resolve(import.meta.dirname, "../../../apps/server/client");

  it("expands the browser shared set for the server client", () => {
    const specifiers = expand(client).map((entry) => entry.specifier);
    expect(specifiers).toContain("solid-js");
    expect(specifiers).toContain("@solidjs/web");
    expect(specifiers).toContain("effect/Schema");
    expect(specifiers).toContain("@macrograph/module/ModuleUI");
    expect(specifiers).toContain("@macrograph/editor-ui/tokens.stylex");
    expect(specifiers).toContain("@tanstack/solid-query");
    expect(specifiers).not.toContain("@macrograph/module/vite");
    expect(specifiers).not.toContain("@macrograph/editor-ui/styles.css");
    expect(specifiers).not.toContain("solid-js/package.json");
    expect(specifiers.some((specifier) => specifier.startsWith("effect/internal/"))).toBe(false);
  });

  it("fails when a shared package cannot be located", () => {
    expect(() => expand(client, ["not-a-real-package"])).toThrow(/not-a-real-package/);
  });
});
