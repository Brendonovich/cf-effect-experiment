import type { UserOptions } from "@stylexjs/unplugin";
import type { Plugin } from "vite";

import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as PackageExports from "./PackageExports.ts";

const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

const stripExtension = (file: string) => {
  const extension = extensions.find((candidate) => file.endsWith(candidate));
  return extension === undefined ? file : file.slice(0, -extension.length);
};

const existingFile = (path: string) => {
  for (const candidate of [path, ...extensions.map((extension) => `${path}${extension}`)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate);
  }
  return undefined;
};

const packageName = (specifier: string) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
};

/** Resolves a `.stylex` import the way the bundler does, including package `exports`. */
export const resolveStylexImport = (importPath: string, sourceFilePath: string) => {
  if (importPath.startsWith(".") || isAbsolute(importPath))
    return existingFile(resolve(dirname(sourceFilePath), importPath));
  const name = packageName(importPath);
  const pkg = PackageExports.locate(name, dirname(sourceFilePath));
  if (pkg === undefined) return undefined;
  const subpath = importPath === name ? "." : `.${importPath.slice(name.length)}`;
  const file = PackageExports.resolveSubpath(pkg, subpath);
  if (file !== undefined) return realpathSync(file);
  return pkg.json.exports === undefined ? existingFile(resolve(pkg.directory, subpath)) : undefined;
};

/**
 * A location-independent name for a StyleX theme file, used to hash `defineVars`,
 * `defineConsts` and `defineMarker` names.
 *
 * A file exported by its package is named by its public specifier, such as
 * `@macrograph/editor-ui/tokens.stylex`, so a module built outside the monorepo against a
 * published package derives the same variable names as the host. Other files fall back to
 * `<package name>:<path in package without extension>`.
 */
export const canonicalStylexPath = (filePath: string) => {
  const file = existsSync(filePath) ? realpathSync(filePath) : filePath;
  const pkg = PackageExports.containing(file);
  if (pkg === undefined) return stripExtension(basename(file));
  return (
    PackageExports.specifierForFile(pkg, file) ??
    `${pkg.name}:${stripExtension(relative(pkg.directory, file).split(sep).join("/"))}`
  );
};

export const moduleResolution = {
  type: "custom",
  filePathResolver: resolveStylexImport,
  getCanonicalFilePath: canonicalStylexPath,
} as const;

/** CSS layer configuration shared by the host and every module stylesheet. */
export const cssLayers = { before: ["reset"], prefix: "stylex" } as const;

/**
 * The canonical `@stylexjs/unplugin` options for the host apps and module UI builds. Pass the
 * result to `stylex.vite(...)` and add {@link layerAnchors} to the plugin list.
 */
export const stylexOptions = (overrides: Partial<UserOptions> = {}): Partial<UserOptions> => ({
  sxPropName: false,
  useCSSLayers: cssLayers,
  runtimeInjection: false,
  unstable_moduleResolution: moduleResolution,
  ...overrides,
});

export const layerAnchorsFile = fileURLToPath(new URL("./LayerAnchors.ts", import.meta.url));

/**
 * Adds {@link layerAnchorsFile} to every build that uses StyleX. StyleX numbers its
 * `stylex.priorityN` layers by the priority levels present in one stylesheet, so a module's
 * separate stylesheet would otherwise put rules in layers that mean a different level in the
 * host's stylesheet. The anchors make every level present everywhere.
 *
 * Place it before the StyleX plugin so it sees the original `@stylexjs/stylex` imports.
 */
export const layerAnchors = (): Plugin => ({
  name: "macrograph:stylex-layer-anchors",
  enforce: "pre",
  transform: {
    filter: { id: /\.[cm]?[jt]sx?(?:\?|$)/, code: "@stylexjs/stylex" },
    handler(code, id) {
      if (id.split("?", 1)[0] === layerAnchorsFile) return;
      // Appended rather than prepended so existing source map positions stay valid.
      return { code: `${code}\nimport ${JSON.stringify(layerAnchorsFile)};\n`, map: null };
    },
  },
});

export * as StyleX from "./StyleX.ts";
