import { moduleSettings, stylexProps } from "@macrograph/module/vite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, it } from "vitest";

it("transforms intrinsic StyleX props while preserving component props", () => {
  const plugin = stylexProps();
  const source = `import type { StyleXStyles } from "@stylexjs/stylex";
import * as stylex from "@stylexjs/stylex";
const view = <><div sx={styles.root} /><svg sx={[styles.icon, active && styles.active]} /><Button sx={styles.button} /></>;`;
  const result = plugin.transform(source, "/src/view.tsx");

  assert.equal(
    result?.code,
    `import type { StyleXStyles } from "@stylexjs/stylex";
import * as stylex from "@stylexjs/stylex";
const view = <><div {...stylex.attrs(styles.root)} /><svg {...stylex.attrs([styles.icon, active && styles.active])} /><Button sx={styles.button} /></>;`,
  );
  assert.ok(result?.map);
});

it("adds a StyleX import when an intrinsic sx prop has no namespace import", () => {
  const plugin = stylexProps();
  const result = plugin.transform("const view = <div sx={styles.root} />;", "/src/view.tsx");

  assert.equal(
    result?.code,
    `import * as __macrographStylex from "@stylexjs/stylex";
const view = <div {...__macrographStylex.attrs(styles.root)} />;`,
  );
  assert.isUndefined(
    plugin.transform("const view = <Button sx={styles.root} />;", "/src/view.tsx"),
  );
});

it("discovers every module package Settings export for production bundling", () => {
  const plugin = moduleSettings();
  const resolved = plugin.resolveId("virtual:macrograph-module-settings");
  assert.equal(typeof resolved, "string");
  const source = plugin.load(resolved ?? "") as string | undefined;
  assert.equal(typeof source, "string");
  assert.match(source ?? "", /modules\/kofi\/src\/Settings\.tsx/);
  assert.match(source ?? "", /modules\/obs\/src\/Settings\.tsx/);
  assert.match(source ?? "", /modules\/twitch\/src\/Settings\.tsx/);
  assert.match(source ?? "", /modules\/utilities\/src\/Settings\.tsx/);
  assert.match(source ?? "", /modules\/websocket-client\/src\/Settings\.tsx/);
  assert.match(source ?? "", /modules\/websocket-server\/src\/Settings\.tsx/);
  assert.notMatch(source ?? "", /modules\/http-client\/src\/Settings/);
});

it("applies host allowlists to settings", () => {
  const include = new Set(["@macrograph/module-obs"]);
  const settings = moduleSettings(undefined, include);
  const settingsSource = settings.load(
    settings.resolveId("virtual:macrograph-module-settings") ?? "",
  ) as string | undefined;
  assert.match(settingsSource ?? "", /modules\/obs\/src\/Settings\.tsx/);
  assert.notMatch(settingsSource ?? "", /modules\/kofi/);
});

it("discovers a fixture module without changing a UI registry", () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-settings-"));
  try {
    const fixture = join(root, "packages/modules/fixture");
    mkdirSync(fixture, { recursive: true });
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "@macrograph/module-fixture",
        exports: { ".": "./src/Module.ts", "./Settings": "./src/Settings.tsx" },
      }),
    );
    const plugin = moduleSettings(root);
    const source = plugin.load(plugin.resolveId("virtual:macrograph-module-settings") ?? "") as
      | string
      | undefined;
    assert.match(source ?? "", /modules\/fixture\/src\/Settings\.tsx/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("keys discovered settings by the built-in id derived from the package name", async () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-settings-"));
  try {
    for (const [name, packageName] of [
      ["first", "@macrograph/module-first"],
      ["second", "@fixture/second"],
    ] as const) {
      const fixture = join(root, "packages/modules", name);
      mkdirSync(fixture, { recursive: true });
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({ name: packageName, exports: { "./Settings": "./Settings.mjs" } }),
      );
      writeFileSync(join(fixture, "Settings.mjs"), `export const settings = { name: "${name}" };`);
    }
    const plugin = moduleSettings(root);
    const source = plugin.load(plugin.resolveId("virtual:macrograph-module-settings") ?? "")!;
    const code = source.replace(
      /from ("[^"]+")/g,
      (_match, path: string) => `from ${JSON.stringify(pathToFileURL(JSON.parse(path)).href)}`,
    );
    const module: {
      default: ReadonlyArray<{ id: string; settings: { name: string } }>;
    } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    assert.deepStrictEqual(module.default, [
      { id: "macrograph.app/macrograph/second", settings: { name: "second" } },
      { id: "macrograph.app/macrograph/first", settings: { name: "first" } },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects duplicate module ids deterministically in the generated module", () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-settings-"));
  try {
    // Both package names map to the built-in id `<official>/macrograph/first`.
    for (const [directory, name] of [
      ["first", "@fixture/first"],
      ["second", "@macrograph/module-first"],
    ] as const) {
      const fixture = join(root, "packages/modules", directory);
      mkdirSync(join(fixture, "src"), { recursive: true });
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name,
          exports: { ".": "./src/Module.ts", "./Settings": "./src/Settings.ts" },
        }),
      );
    }
    const plugin = moduleSettings(root);
    const source = plugin.load(plugin.resolveId("virtual:macrograph-module-settings") ?? "") as
      | string
      | undefined;
    assert.match(source ?? "", /Duplicate module id/);
    assert.match(source ?? "", /@fixture\/first/);
    assert.match(source ?? "", /@macrograph\/module-first/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
