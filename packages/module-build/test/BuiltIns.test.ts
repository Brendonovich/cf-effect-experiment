import { NativeAddons } from "@macrograph/module-host/NativeAddons";
import { VmLoader } from "@macrograph/module-host/VmLoader";
import { Manifest } from "@macrograph/module/Manifest";
import * as Module from "@macrograph/module/Module";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { Effect } from "effect";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileFunction } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Build } from "../src/Build.ts";
import { Checks } from "../src/Checks.ts";

const modulesDirectory = resolve(import.meta.dirname, "../../modules");
const builtIns = readdirSync(modulesDirectory, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(modulesDirectory, entry.name, "package.json")),
  )
  .map((entry) => entry.name)
  .sort();

const outRoot = mkdtempSync(join(tmpdir(), "macrograph-module-build-"));
const results = new Map<string, Build.Result>();
const nodeRequire = createRequire(import.meta.url);

/** Evaluates a server entry the way the host does, with the test's own shared library instances. */
const evaluateServerEntry = async (path: string, manifest: Manifest.Model) => {
  const code = readFileSync(path, "utf8");
  const { requires } = Checks.analyzeServerEntry(code, { manifest });
  const shared = new Map<string, unknown>();
  for (const specifier of requires)
    if (SharedLibraries.isShared(specifier, "server"))
      shared.set(specifier, await import(specifier));
  const required = new Set<string>();
  const require = (specifier: string): unknown => {
    required.add(specifier);
    if (shared.has(specifier)) return shared.get(specifier);
    if (Manifest.allowsNodeBuiltin(manifest, specifier)) return nodeRequire(specifier);
    throw new Error(`Cannot find module '${specifier}'`);
  };
  const module: ModulePackage.ServerEntryModule = { exports: {} };
  const wrapper = compileFunction(code, [...ModulePackage.ServerEntryParameters], {
    filename: path,
  });
  wrapper(require, module, module.exports);
  return { value: ModulePackage.serverEntryDefault(module), required };
};

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

beforeAll(async () => {
  for (const name of builtIns) {
    const result = await Effect.runPromise(
      Build.build({
        packageDirectory: join(modulesDirectory, name),
        outDirectory: join(outRoot, name),
      }),
    );
    results.set(name, result);
  }
}, 600_000);

afterAll(() => rmSync(outRoot, { recursive: true, force: true }));

describe.each(builtIns)("built-in %s", (name) => {
  const outDirectory = () => join(outRoot, name);

  it("has a valid manifest named after the package", async () => {
    const manifest = await Effect.runPromise(
      Manifest.decodeJson(readFileSync(join(outDirectory(), ModulePackage.ManifestFile), "utf8")),
    );
    expect(manifest.publisher).toBe("macrograph");
    expect(manifest.name).toBe(name);
    expect(manifest.api).toBe(Manifest.ApiVersion);
    expect(manifest.server).toBe(ModulePackage.ServerEntry);
    expect(Manifest.isSemver(manifest.version)).toBe(true);
  });

  it("passes the bundle checks", async () => {
    const files = await Effect.runPromise(Build.readPackageFiles(outDirectory()));
    const { issues } = Checks.checkPackage(files);
    expect(Checks.errors(issues)).toEqual([]);
  });

  it("evaluates the server entry with the host's shared libraries", async () => {
    const manifest = results.get(name)!.manifest;
    const { value, required } = await evaluateServerEntry(
      join(outDirectory(), ModulePackage.ServerEntry),
      manifest,
    );
    expect(
      typeof field(value, "effect") === "function" ||
        typeof field(field(value, "module"), "effect") === "function",
    ).toBe(true);
    if (field(value, "definition") !== undefined) {
      expect(field(value, "layer")).toBeDefined();
      expect(field(field(value, "module"), "engine")).toBe(field(value, "definition"));
    } else {
      expect(field(value, "engine")).toBeUndefined();
    }
    for (const specifier of required)
      expect(
        SharedLibraries.isShared(specifier, "server") ||
          Manifest.allowsNodeBuiltin(manifest, specifier),
      ).toBe(true);
  });

  it("has a UI entry exactly when the module has settings", () => {
    const hasSettings = existsSync(join(modulesDirectory, name, "src", "Settings.tsx"));
    const manifest = results.get(name)!.manifest;
    expect(manifest.ui !== undefined).toBe(hasSettings);
    expect(existsSync(join(outDirectory(), ModulePackage.UiEntry))).toBe(hasSettings);
    if (manifest.ui !== undefined) {
      expect(manifest.ui.entry).toBe(ModulePackage.UiEntry);
      for (const style of manifest.ui.styles)
        expect(existsSync(join(outDirectory(), style))).toBe(true);
      const entry = readFileSync(join(outDirectory(), ModulePackage.UiEntry), "utf8");
      expect(entry).toMatch(/from\s*"@macrograph\/module\/ModuleUI"/);
    }
  });
});

describe("MIDI native addon", () => {
  const outDirectory = () => join(outRoot, "midi");

  it("packages the prebuilt addon instead of bundling its loader", () => {
    const manifest = results.get("midi")!.manifest;
    expect(manifest.native).toEqual(["midi"]);
    const binaries = readdirSync(join(outDirectory(), ModulePackage.NativeDirectory, "midi"));
    expect(binaries).toContain("linux-x64.node");
    expect(binaries).toContain("linux-x64-musl.node");
    expect(binaries).toContain("darwin-arm64.node");
    expect(binaries).toContain("win32-x64.node");
    const code = readFileSync(join(outDirectory(), ModulePackage.ServerEntry), "utf8");
    expect(code).toContain('require("macrograph:native/midi")');
    expect(code).not.toMatch(/pkg-prebuilds|pkgPrebuilds|binding-options/);
    expect(code).not.toContain('require("@julusian/midi")');
  });

  it("evaluates with the host's loader and loads the addon for this platform", () => {
    const manifest = results.get("midi")!.manifest;
    const input = { id: Module.builtinId("midi"), root: outDirectory(), manifest };
    const filename = join(outDirectory(), ModulePackage.ServerEntry);
    const deployment = VmLoader.evaluateSource(input, readFileSync(filename, "utf8"), filename);
    expect(field(deployment, "layer")).toBeDefined();
    const target = NativeAddons.currentTarget();
    if (!existsSync(join(outDirectory(), ModulePackage.nativePath("midi", target)))) return;
    const midi = NativeAddons.load(input, "midi");
    const Input = field(midi, "Input");
    expect(typeof Input).toBe("function");
  });
});
