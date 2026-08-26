import { pluginDeployments, pluginSettings, stylexProps } from "@macrograph/plugin/vite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

it("discovers every plugin package Settings export for production bundling", () => {
  const plugin = pluginSettings();
  const resolved = plugin.resolveId("virtual:macrograph-plugin-settings");
  assert.equal(typeof resolved, "string");
  const source = plugin.load(resolved ?? "") as string | undefined;
  assert.equal(typeof source, "string");
  assert.match(source ?? "", /plugins\/kofi\/src\/Settings\.tsx/);
  assert.match(source ?? "", /plugins\/obs\/src\/Settings\.tsx/);
  assert.match(source ?? "", /plugins\/twitch\/src\/Settings\.tsx/);
  assert.match(source ?? "", /plugins\/utilities\/src\/Settings\.tsx/);
  assert.match(source ?? "", /plugins\/websocket-client\/src\/Settings\.tsx/);
  assert.match(source ?? "", /plugins\/websocket-server\/src\/Settings\.tsx/);
  assert.notMatch(source ?? "", /plugins\/http-client\/src\/Settings/);
});

it("applies host allowlists to settings and standalone deployments", () => {
  const include = new Set(["@macrograph/plugin-obs"]);
  const settings = pluginSettings(undefined, include);
  const settingsSource = settings.load(
    settings.resolveId("virtual:macrograph-plugin-settings") ?? "",
  ) as string | undefined;
  assert.match(settingsSource ?? "", /plugins\/obs\/src\/Settings\.tsx/);
  assert.notMatch(settingsSource ?? "", /plugins\/kofi/);

  const deployments = pluginDeployments(undefined, include);
  const deploymentsSource = deployments.load(
    deployments.resolveId("virtual:macrograph-plugin-deployments") ?? "",
  ) as string | undefined;
  assert.match(deploymentsSource ?? "", /plugins\/obs\/src\/Deployment\/WebSocket\.ts/);
  assert.notMatch(deploymentsSource ?? "", /plugins\/kofi/);
});

it("discovers a fixture plugin without changing a UI registry", () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-settings-"));
  try {
    const fixture = join(root, "packages/plugins/fixture");
    mkdirSync(fixture, { recursive: true });
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "@macrograph/plugin-fixture",
        exports: { "./Settings": "./src/Settings.tsx" },
      }),
    );
    const plugin = pluginSettings(root);
    const source = plugin.load(plugin.resolveId("virtual:macrograph-plugin-settings") ?? "") as
      | string
      | undefined;
    assert.match(source ?? "", /plugins\/fixture\/src\/Settings\.tsx/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects duplicate plugin ids deterministically in the generated module", () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-settings-"));
  try {
    for (const name of ["first", "second"]) {
      const fixture = join(root, "packages/plugins", name);
      mkdirSync(join(fixture, "src"), { recursive: true });
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name: `@fixture/${name}`,
          exports: { "./Settings": "./src/Settings.ts" },
        }),
      );
    }
    const plugin = pluginSettings(root);
    const source = plugin.load(plugin.resolveId("virtual:macrograph-plugin-settings") ?? "") as
      | string
      | undefined;
    assert.match(source ?? "", /Duplicate plugin id/);
    assert.match(source ?? "", /@fixture\/first/);
    assert.match(source ?? "", /@fixture\/second/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("discovers a standalone deployment and invalidates the virtual module on plugin changes", () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-deployment-"));
  try {
    const fixture = join(root, "packages/plugins/fixture");
    mkdirSync(join(fixture, "src"), { recursive: true });
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "@fixture/deployment",
        macrograph: { standaloneDeployment: "./src/Deployment.ts" },
      }),
    );
    const plugin = pluginDeployments(root);
    const resolved = plugin.resolveId("virtual:macrograph-plugin-deployments");
    const source = plugin.load(resolved ?? "") as string | undefined;
    assert.match(source ?? "", /plugins\/fixture\/src\/Deployment\.ts/);

    const module = {};
    let invalidated: unknown;
    const updates = plugin.handleHotUpdate({
      file: join(fixture, "package.json"),
      server: {
        moduleGraph: {
          getModuleById: () => module,
          invalidateModule: (candidate) => {
            invalidated = candidate;
          },
        },
      },
    });
    assert.strictEqual(invalidated, module);
    assert.deepStrictEqual(updates, [module]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
