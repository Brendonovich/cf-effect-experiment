import type { ModuleId } from "@macrograph/module/ModuleId";

import { Manifest } from "@macrograph/module/Manifest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { ModuleFiles } from "./ModuleFiles.ts";

export class NativeAddonError extends Error {
  override readonly name = "NativeAddonError";
}

let musl: boolean | undefined;

/** Whether this Linux process runs on musl libc: glibc builds report their runtime version. */
const isMusl = () => {
  if (musl !== undefined) return musl;
  const report: unknown = process.report.getReport();
  const header =
    typeof report === "object" && report !== null ? Reflect.get(report, "header") : undefined;
  const glibc =
    typeof header === "object" && header !== null
      ? Reflect.get(header, "glibcVersionRuntime")
      : undefined;
  musl = typeof glibc !== "string";
  return musl;
};

/** The native target of this process, e.g. `darwin-arm64` or `linux-x64-musl`. */
export const currentTarget = () =>
  ModulePackage.nativeTarget({
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === "linux" && isMusl(),
  });

/**
 * Addons loaded by this process, keyed by real path. Native code can't be unloaded, and
 * Node-API addons may fail to initialize when opened twice, so reloading or unloading a module
 * reuses the same exports. Native addons are the one part of a module a reload can't free.
 */
const loaded = new Map<string, unknown>();

export interface Input {
  readonly id: ModuleId.Id;
  /** The module's package folder. */
  readonly root: string;
  readonly manifest: Manifest.Model;
}

/**
 * Loads a native addon the manifest declares from `native/<name>/<target>.node` inside the
 * package folder.
 */
export const load = (input: Input, name: string, target: string = currentTarget()): unknown => {
  if (!Manifest.declaresNative(input.manifest, name))
    throw new NativeAddonError(
      `${input.id}: native addon "${name}" is not declared; add "${name}" to the manifest's "native" list`,
    );
  const relativePath = ModulePackage.nativePath(name, target);
  const path = join(input.root, relativePath);
  if (!existsSync(path))
    throw new NativeAddonError(
      `${input.manifest.displayName} has no native build for ${target} (${input.id} is missing ${relativePath})`,
    );
  const real = realpathSync(path);
  if (!ModuleFiles.isWithin(realpathSync(input.root), real))
    throw new NativeAddonError(
      `${input.id}: ${relativePath} resolves outside the module package folder`,
    );
  if (loaded.has(real)) return loaded.get(real);
  const module: { exports: unknown } = { exports: {} };
  process.dlopen(module, real);
  loaded.set(real, module.exports);
  return module.exports;
};

export * as NativeAddons from "./NativeAddons.ts";
