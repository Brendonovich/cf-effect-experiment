import { Manifest } from "@macrograph/module/Manifest";
import { Option } from "effect";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { ModuleUrls } from "./ModuleUrls.ts";

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
  kind: ModuleUrls.StaticKind,
  path: string,
): Option.Option<string> => {
  if (!Manifest.isPackagePath(path) || path.includes("\0")) return Option.none();
  const base = resolve(root, ModuleUrls.folder(kind));
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

/** Whether `child` is `parent` or inside it. */
export const isWithin = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

export * as ModuleFiles from "./ModuleFiles.ts";
