import { ModuleId } from "@macrograph/module/ModuleId";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { Effect } from "effect";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Checks } from "../src/Checks.ts";
import { main } from "../src/Cli.ts";
import { Distribution } from "../src/Distribution.ts";
import { UiBuild } from "../src/UiBuild.ts";

const fixtures = resolve(import.meta.dirname, "fixtures");
const modules = resolve(import.meta.dirname, "../../modules");
const outRoot = mkdtempSync(join(tmpdir(), "macrograph-module-ui-styles-"));
afterAll(() => rmSync(outRoot, { recursive: true, force: true }));

const files = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();

const packageFolder = (tree: string, name: string, publisher = "fixture") =>
  join(tree, ModuleId.OfficialNamespace, publisher, name, "0.1.0");

const styles = (folder: string) => readFileSync(join(folder, ModulePackage.UiStyles), "utf8");

const bareImports = (code: string) =>
  new Set(
    [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./][^"']*)["']/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );

const varNames = (css: string, pattern: RegExp) =>
  new Set(
    [...css.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
  );

const anchor = "--macrograph-layer-anchor";

describe("UI stylesheets", () => {
  const twoModules = [join(fixtures, "styles-a"), join(fixtures, "styles-b")];

  const expectIsolated = (tree: string) => {
    expect(files(tree)).toEqual(
      ["styles-a", "styles-b"].flatMap((name) =>
        [
          ModulePackage.ManifestFile,
          ModulePackage.ServerEntry,
          ModulePackage.UiEntry,
          ModulePackage.UiStyles,
        ].map((file) => relative(tree, join(packageFolder(tree, name), file))),
      ),
    );
    const a = styles(packageFolder(tree, "styles-a"));
    const b = styles(packageFolder(tree, "styles-b"));
    expect(a).toContain("1111px");
    expect(a).not.toContain("2222px");
    expect(b).toContain("2222px");
    expect(b).not.toContain("1111px");
    expect(a).toContain(anchor);
    expect(b).toContain(anchor);
  };

  it("doesn't share StyleX rules between modules built in one buildTree", async () => {
    for (const concurrency of [1, 2]) {
      const tree = join(outRoot, `tree-${concurrency}`);
      await Effect.runPromise(
        Distribution.buildTree({
          packageDirectories: twoModules,
          outDirectory: tree,
          concurrency,
        }),
      );
      expectIsolated(tree);
    }
  }, 120_000);

  it("doesn't share StyleX rules between modules packaged by one CLI invocation", async () => {
    const tree = join(outRoot, "cli");
    expect(await main(["package", ...twoModules, "--out", tree])).toBe(0);
    expectIsolated(tree);
  }, 120_000);
});

describe("built-in UI against the host", () => {
  const tree = join(outRoot, "built-ins");
  const names = ["obs", "websocket-client"];
  let hostTokens = new Set<string>();

  beforeAll(async () => {
    await Effect.runPromise(
      Distribution.buildTree({
        packageDirectories: names.map((name) => join(modules, name)),
        outDirectory: tree,
      }),
    );
    // The host compiles editor-ui's tokens with the same StyleX options; building the theme
    // file alone yields exactly the `:root` variables the host's stylesheet defines.
    const tokens = realpathSync(
      createRequire(join(modules, "obs", "package.json")).resolve(
        "@macrograph/editor-ui/tokens.stylex",
      ),
    );
    const host = join(outRoot, "host-tokens");
    await UiBuild.isolated({
      packageDirectory: dirname(tokens),
      entry: tokens,
      outDirectory: host,
      minify: false,
    });
    hostTokens = varNames(readFileSync(join(host, "styles.css"), "utf8"), /(--x[a-z0-9]+)\s*:/g);
  }, 180_000);

  it.each(names)("%s keeps every shared browser library external", (name) => {
    const folder = packageFolder(tree, name, "macrograph");
    const uiFiles = files(join(folder, ModulePackage.UiDirectory)).filter((file) =>
      file.endsWith(".js"),
    );
    for (const file of uiFiles) {
      const code = readFileSync(join(folder, ModulePackage.UiDirectory, file), "utf8");
      expect(Checks.checkUiChunk(code, file)).toEqual([]);
      for (const specifier of bareImports(code))
        expect(SharedLibraries.isShared(specifier, "browser"), specifier).toBe(true);
    }
    const entry = readFileSync(join(folder, ModulePackage.UiEntry), "utf8");
    expect(bareImports(entry)).toContain("@macrograph/module/ModuleUI");
  });

  it.each(names)("%s styles use the host's token variables and layer anchors", (name) => {
    const css = styles(packageFolder(tree, name, "macrograph"));
    expect(css).toContain(anchor);
    const used = varNames(css, /var\((--x[a-z0-9]+)/g);
    expect(used.size).toBeGreaterThan(0);
    expect(hostTokens.size).toBeGreaterThan(0);
    for (const variable of used) expect(hostTokens, variable).toContain(variable);
  });
});
