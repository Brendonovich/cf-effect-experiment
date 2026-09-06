import { moduleDeployments, moduleSettings, stylexProps } from "@macrograph/module/vite";
import { rejects } from "node:assert/strict";
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

it("applies host allowlists to settings and standalone deployments", () => {
  const include = new Set(["@macrograph/module-obs"]);
  const settings = moduleSettings(undefined, include);
  const settingsSource = settings.load(
    settings.resolveId("virtual:macrograph-module-settings") ?? "",
  ) as string | undefined;
  assert.match(settingsSource ?? "", /modules\/obs\/src\/Settings\.tsx/);
  assert.notMatch(settingsSource ?? "", /modules\/kofi/);

  const deployments = moduleDeployments(undefined, include);
  const deploymentsSource = deployments.load(
    deployments.resolveId("virtual:macrograph-module-deployments") ?? "",
  ) as string | undefined;
  assert.match(deploymentsSource ?? "", /modules\/obs\/src\/Deployment\/WebSocket\.ts/);
  assert.notMatch(deploymentsSource ?? "", /modules\/kofi/);
});

it("discovers engine-less exports alongside deployments without mounting undeployed engines", async () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-stateless-"));
  try {
    for (const [name, value, deployment] of [
      ["pure", '{ id: "pure" }', false],
      [
        "engine",
        '{ moduleId: "engine", definition: {}, module: { id: "engine", engine: {} } }',
        true,
      ],
      ["undeployed", '{ id: "undeployed", engine: {} }', false],
    ] as const) {
      const fixture = join(root, "packages/modules", name);
      mkdirSync(fixture, { recursive: true });
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name: `@fixture/${name}`,
          exports: { ".": "./Module.mjs" },
          ...(deployment ? { macrograph: { standaloneDeployment: "./Deployment.mjs" } } : {}),
        }),
      );
      writeFileSync(
        join(fixture, deployment ? "Deployment.mjs" : "Module.mjs"),
        `export default ${value};`,
      );
    }
    const discovery = moduleDeployments(root);
    const source = discovery.load(
      discovery.resolveId("virtual:macrograph-module-deployments") ?? "",
    )!;
    const code = source.replace(
      /from ("[^"]+")/g,
      (_match, path: string) => `from ${JSON.stringify(pathToFileURL(JSON.parse(path)).href)}`,
    );
    const module: { default: ReadonlyArray<{ id?: string; moduleId?: string }> } = await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    assert.deepStrictEqual(
      module.default.map((value) => value.moduleId ?? value.id),
      ["engine", "pure"],
    );
    assert.notMatch(source, /engine\/Module\.mjs/);
    const duplicate = code.replace(
      "const discovered = [",
      'const discovered = [{ value: { id: "engine" }, source: "@fixture/duplicate" }, ',
    );
    await rejects(
      import(`data:text/javascript;base64,${Buffer.from(duplicate).toString("base64")}`),
      /Duplicate module id engine/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
        exports: { "./Settings": "./src/Settings.tsx" },
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

it("rejects duplicate module ids deterministically in the generated module", () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-settings-"));
  try {
    for (const name of ["first", "second"]) {
      const fixture = join(root, "packages/modules", name);
      mkdirSync(join(fixture, "src"), { recursive: true });
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name: `@fixture/${name}`,
          exports: { "./Settings": "./src/Settings.ts" },
        }),
      );
    }
    const plugin = moduleSettings(root);
    const source = plugin.load(plugin.resolveId("virtual:macrograph-module-settings") ?? "") as
      | string
      | undefined;
    assert.match(source ?? "", /Duplicate module id/);
    assert.match(source ?? "", /@fixture\/first/);
    assert.match(source ?? "", /@fixture\/second/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("discovers a standalone deployment and invalidates the virtual module on module changes", () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-deployment-"));
  try {
    const fixture = join(root, "packages/modules/fixture");
    mkdirSync(join(fixture, "src"), { recursive: true });
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "@fixture/deployment",
        macrograph: { standaloneDeployment: "./src/Deployment.ts" },
      }),
    );
    const plugin = moduleDeployments(root);
    const resolved = plugin.resolveId("virtual:macrograph-module-deployments");
    const source = plugin.load(resolved ?? "") as string | undefined;
    assert.match(source ?? "", /modules\/fixture\/src\/Deployment\.ts/);

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
