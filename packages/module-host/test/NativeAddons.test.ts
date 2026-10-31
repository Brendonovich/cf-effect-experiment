import type { Manifest } from "@macrograph/module/Manifest";

import { assert, describe, it } from "@effect/vitest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { NativeAddons } from "../src/NativeAddons.ts";
import { VmLoader } from "../src/VmLoader.ts";
import { official, tempDir } from "./helpers.ts";

// The MIDI built-in's real prebuilt addon, so the test exercises an actual Node-API binary.
const midiPackage = dirname(
  createRequire(resolve(import.meta.dirname, "../../modules/midi/package.json")).resolve(
    "@julusian/midi/package.json",
  ),
);
const target = NativeAddons.currentTarget();
const prebuild = join(midiPackage, "prebuilds", `midi-${target}`, "node-napi-v7.node");
const hasMidiSequencer = process.platform !== "linux" || existsSync("/dev/snd/seq");

const manifest = (native: ReadonlyArray<string> = ["midi"]): Manifest.Model => ({
  manifest: 1,
  publisher: "fixtures",
  name: "native",
  version: "1.0.0",
  api: 1,
  displayName: "MIDI",
  server: "server.cjs",
  native,
});

const packageWithAddon = () => {
  const root = tempDir();
  const path = join(root, ModulePackage.nativePath("midi", target));
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(prebuild, path);
  return root;
};

const evaluate = (root: string, code: string, native?: ReadonlyArray<string>) =>
  VmLoader.evaluateSource(
    { id: official("native"), root, manifest: manifest(native) },
    code,
    join(root, "server.cjs"),
  );

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

describe.runIf(existsSync(prebuild))("NativeAddons", () => {
  it("detects the current target", () => {
    assert.strictEqual(target.split("-")[0], process.platform);
    assert.isTrue(ModulePackage.isNativeTarget(target));
  });

  it("loads a declared addon and calls into it", () => {
    const root = packageWithAddon();
    const code = `const midi = require("macrograph:native/midi");
      const input = new midi.Input(() => {});
      const count = input.getPortCount();
      input.destroy();
      exports.default = { midi, count, names: midi.getInputPortNames() };`;
    // Without an ALSA sequencer RtMidi can't start, but reaching that error still means the addon ran.
    if (!hasMidiSequencer) {
      assert.throws(() => evaluate(root, code), /Failed to initialise RtMidi/);
      return;
    }
    const value = evaluate(root, code);
    assert.isTrue(typeof field(value, "count") === "number");
    assert.isTrue(Array.isArray(field(value, "names")));
  });

  it("opens each addon file once and reuses it on reload", () => {
    const root = packageWithAddon();
    const code = 'exports.default = require("macrograph:native/midi");';
    const first = evaluate(root, code);
    const second = evaluate(root, code);
    assert.isTrue(typeof field(first, "Input") === "function");
    assert.strictEqual(first, second);
  });

  it("refuses addons the manifest doesn't declare", () => {
    const root = packageWithAddon();
    assert.throws(
      () => evaluate(root, 'require("macrograph:native/midi");', []),
      /native addon "midi" is not declared/,
    );
    assert.throws(
      () => evaluate(root, 'require("macrograph:native/serial");'),
      /native addon "serial" is not declared/,
    );
  });

  it("names the missing target", () => {
    const root = packageWithAddon();
    assert.throws(
      () =>
        NativeAddons.load(
          { id: official("native"), root, manifest: manifest() },
          "midi",
          "linux-riscv64",
        ),
      /MIDI has no native build for linux-riscv64/,
    );
  });

  it("refuses binaries that resolve outside the package folder", () => {
    const outside = packageWithAddon();
    const root = tempDir();
    const path = join(root, ModulePackage.nativePath("midi", target));
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(join(outside, ModulePackage.nativePath("midi", target)), path);
    assert.throws(
      () => evaluate(root, 'require("macrograph:native/midi");'),
      /resolves outside the module package folder/,
    );
  });
});
