/** File and folder names inside a module package folder. */
export const ManifestFile = "macrograph.json";
export const ServerEntry = "server.cjs";
export const UiDirectory = "ui";
export const UiEntry = "ui/index.js";
export const UiStyles = "ui/styles.css";
export const AssetsDirectory = "assets";
export const NativeDirectory = "native";

/**
 * Platforms native addons are packaged for: `<platform>-<arch>` as reported by Node, plus
 * `-musl` on musl-based Linux.
 */
export const NativeTargets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm",
  "linux-arm64",
  "linux-arm64-musl",
  "linux-x64",
  "linux-x64-musl",
  "win32-arm64",
  "win32-ia32",
  "win32-x64",
] as const;
export type NativeTarget = (typeof NativeTargets)[number];

export const isNativeTarget = (value: string): value is NativeTarget =>
  (NativeTargets as ReadonlyArray<string>).includes(value);

/** The target string for a platform, e.g. `linux-x64-musl`. Unknown platforms produce unknown targets. */
export const nativeTarget = (options: {
  readonly platform: string;
  readonly arch: string;
  readonly musl: boolean;
}): string =>
  `${options.platform}-${options.arch}${options.platform === "linux" && options.musl ? "-musl" : ""}`;

/** Where a native addon's binary for one target lives: `native/<name>/<target>.node`. */
export const nativePath = (name: string, target: string) =>
  `${NativeDirectory}/${name}/${target}.node`;

/** Splits a `native/<name>/<target>.node` path. */
export const parseNativePath = (
  path: string,
): { readonly name: string; readonly target: string } | undefined => {
  const match = /^native\/([^/]+)\/([^/]+)\.node$/.exec(path);
  return match === null ? undefined : { name: match[1]!, target: match[2]! };
};

/** Server entries load a declared native addon with `require("macrograph:native/<name>")`. */
export const NativeSpecifierPrefix = "macrograph:native/";

export const nativeSpecifier = (name: string) => `${NativeSpecifierPrefix}${name}`;

/** The addon name of a `macrograph:native/<name>` specifier. */
export const parseNativeSpecifier = (specifier: string): string | undefined =>
  specifier.startsWith(NativeSpecifierPrefix)
    ? specifier.slice(NativeSpecifierPrefix.length)
    : undefined;

/**
 * The server entry is a CommonJS-style function body. The host compiles it with these
 * parameters and reads `module.exports.default` (or `module.exports`) as the deployment
 * or engine-less module.
 */
export const ServerEntryParameters = ["require", "module", "exports"] as const;

export interface ServerEntryModule {
  exports: unknown;
}

export type ServerEntryRequire = (specifier: string) => unknown;

/** Reads the default export of an evaluated server entry. */
export const serverEntryDefault = (module: ServerEntryModule): unknown => {
  const exports = module.exports;
  return typeof exports === "object" && exports !== null && "default" in exports
    ? exports.default
    : exports;
};

export * as ModulePackage from "./ModulePackage.ts";
