/** File and folder names inside a module package folder. */
export const ManifestFile = "macrograph.json";
export const ServerEntry = "server.cjs";
export const UiDirectory = "ui";
export const UiEntry = "ui/index.js";
export const UiStyles = "ui/styles.css";
export const AssetsDirectory = "assets";

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
