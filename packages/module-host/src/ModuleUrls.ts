import { Manifest } from "@macrograph/module/Manifest";
import { ModuleId } from "@macrograph/module/ModuleId";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Option } from "effect";
import { realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep, isAbsolute } from "node:path";

import { ContentHash } from "./ContentHash.ts";

/**
 * Static module files are served from `<routePrefix>/<kind>/<version>/<path>`, where `kind` is
 * `ui` or `assets`, `version` is the short content hash and `path` is relative to the kind's
 * folder. Keeping the version as a path segment means relative imports between UI chunks stay
 * versioned too, so every response can be cached as immutable.
 */
export type StaticKind = "ui" | "assets";

const folder = (kind: StaticKind) =>
  kind === "ui" ? ModulePackage.UiDirectory : ModulePackage.AssetsDirectory;

/** The path inside the kind's folder for a manifest package path, if it lives there. */
export const pathInKind = (kind: StaticKind, packagePath: string): Option.Option<string> => {
  const prefix = `${folder(kind)}/`;
  return Manifest.isPackagePath(packagePath) &&
    packagePath.startsWith(prefix) &&
    packagePath.length > prefix.length
    ? Option.some(packagePath.slice(prefix.length))
    : Option.none();
};

/** Versioned URL for a package path such as `ui/index.js` or `assets/icon.svg`. */
export const url = (
  id: ModuleId.Id,
  contentHash: string,
  kind: StaticKind,
  packagePath: string,
): Option.Option<string> =>
  Option.map(
    pathInKind(kind, packagePath),
    (path) => `${ModuleId.routePrefix(id)}/${kind}/${ContentHash.short(contentHash)}/${path}`,
  );

/** Splits the part of a static URL after `<kind>/` into its version and file path. */
export const parseStaticPath = (
  rest: string,
): Option.Option<{ readonly version: string; readonly path: string }> => {
  const slash = rest.indexOf("/");
  if (slash <= 0) return Option.none();
  const version = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  return Manifest.isPackagePath(path) ? Option.some({ version, path }) : Option.none();
};

/** Whether a URL version matches the module's current content hash. */
export const isCurrentVersion = (version: string, contentHash: string) =>
  version === ContentHash.short(contentHash);

const isInside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
};

/**
 * The absolute file for a path inside a module's `ui/` or `assets/` folder. Rejects paths that
 * escape the folder, including through symlinks, and paths that don't exist.
 */
export const resolveFile = (
  root: string,
  kind: StaticKind,
  path: string,
): Option.Option<string> => {
  if (!Manifest.isPackagePath(path) || path.includes("\0")) return Option.none();
  const base = resolve(root, folder(kind));
  const candidate = resolve(join(base, path));
  if (!isInside(base, candidate)) return Option.none();
  try {
    const real = realpathSync(candidate);
    return isInside(realpathSync(base), real) && statSync(real).isFile()
      ? Option.some(real)
      : Option.none();
  } catch {
    return Option.none();
  }
};

export * as ModuleUrls from "./ModuleUrls.ts";
