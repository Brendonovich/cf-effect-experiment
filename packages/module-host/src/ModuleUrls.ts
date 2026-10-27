import { Manifest } from "@macrograph/module/Manifest";
import { ModuleId } from "@macrograph/module/ModuleId";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Option } from "effect";

/**
 * Static module files are served from `<routePrefix>/<kind>/<version>/<path>`, where `kind` is
 * `ui` or `assets`, `version` is the short content hash and `path` is relative to the kind's
 * folder. Keeping the version as a path segment means relative imports between UI chunks stay
 * versioned too, so every response can be cached as immutable.
 */
export type StaticKind = "ui" | "assets";

/** The short form of a content hash used in versioned URLs. */
export const short = (hash: string) => hash.slice(0, 16);

export const folder = (kind: StaticKind) =>
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
    (path) => `${ModuleId.routePrefix(id)}/${kind}/${short(contentHash)}/${path}`,
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
  version === short(contentHash);

export * as ModuleUrls from "./ModuleUrls.ts";
