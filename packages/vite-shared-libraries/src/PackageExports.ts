import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** The parts of `package.json` used to resolve subpaths. */
export interface PackageJson {
  readonly name?: string;
  readonly exports?: unknown;
  readonly main?: string;
}

export interface Package {
  readonly name: string;
  readonly directory: string;
  readonly json: PackageJson;
}

/** Conditions matching what Vite resolves for a production browser build. */
export const browserConditions: ReadonlyArray<string> = [
  "browser",
  "import",
  "module",
  "production",
  "default",
];

const scriptExtensions = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"];

export const isScript = (file: string) =>
  scriptExtensions.some((extension) => file.endsWith(extension)) && !/\.d\.[cm]?ts$/.test(file);

const toPosix = (path: string) => path.split(sep).join("/");

const readJson = (file: string): PackageJson | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
};

export const read = (directory: string): Package | undefined => {
  const json = readJson(join(directory, "package.json"));
  return json?.name === undefined ? undefined : { name: json.name, directory, json };
};

/** The nearest package containing `file`, skipping `package.json` files without a name. */
export const containing = (file: string): Package | undefined => {
  let directory = dirname(file);
  for (;;) {
    const found = read(directory);
    if (found !== undefined) return found;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

/** Locates an installed package the way Node does, starting from `fromDirectory`. */
export const locate = (name: string, fromDirectory: string): Package | undefined => {
  let directory = fromDirectory;
  for (;;) {
    const self = read(directory);
    if (self?.name === name) return { ...self, directory: realpathSync(directory) };
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      const found = read(realpathSync(candidate));
      if (found !== undefined) return found;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

const exportsMap = (json: PackageJson): Readonly<Record<string, unknown>> => {
  const value = json.exports;
  if (value === undefined) return json.main === undefined ? {} : { ".": `./${json.main}` };
  if (typeof value === "string" || Array.isArray(value)) return { ".": value };
  if (typeof value !== "object" || value === null) return {};
  const entries = Object.entries(value);
  return entries.every(([key]) => !key.startsWith("."))
    ? { ".": value }
    : Object.fromEntries(entries);
};

/** Resolves a conditional export target. `null` means the subpath is explicitly blocked. */
const resolveTarget = (
  target: unknown,
  conditions: ReadonlyArray<string>,
): string | null | undefined => {
  if (target === null) return null;
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item, conditions);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  if (typeof target !== "object") return undefined;
  for (const [condition, value] of Object.entries(target)) {
    if (condition !== "default" && !conditions.includes(condition)) continue;
    const resolved = resolveTarget(value, conditions);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
};

/** Every non-type target string, for mapping files back to subpaths. */
const leafTargets = (target: unknown): ReadonlyArray<string> => {
  if (typeof target === "string") return [target];
  if (Array.isArray(target)) return target.flatMap(leafTargets);
  if (typeof target !== "object" || target === null) return [];
  return Object.entries(target).flatMap(([condition, value]) =>
    condition === "types" ? [] : leafTargets(value),
  );
};

const normalizeTarget = (target: string) => (target.startsWith("./") ? target : `./${target}`);

const wildcard = (pattern: string) => {
  const index = pattern.indexOf("*");
  return index === -1 || pattern.indexOf("*", index + 1) !== -1
    ? undefined
    : { prefix: pattern.slice(0, index), suffix: pattern.slice(index + 1) };
};

const matchWildcard = (pattern: string, value: string) => {
  const parts = wildcard(pattern);
  if (parts === undefined) return undefined;
  if (
    value.length < parts.prefix.length + parts.suffix.length ||
    !value.startsWith(parts.prefix) ||
    !value.endsWith(parts.suffix)
  )
    return undefined;
  return value.slice(parts.prefix.length, value.length - parts.suffix.length);
};

/** Resolves a subpath such as `.` or `./Schema` to a file, following Node's `exports` rules. */
export const resolveSubpath = (
  pkg: Package,
  subpath: string,
  conditions: ReadonlyArray<string> = browserConditions,
): string | undefined => {
  const map = exportsMap(pkg.json);
  let target: string | null | undefined;
  if (subpath in map && !subpath.includes("*")) {
    target = resolveTarget(map[subpath], conditions);
  } else {
    let best: { key: string; star: string } | undefined;
    for (const key of Object.keys(map)) {
      const star = matchWildcard(key, subpath);
      if (star === undefined) continue;
      const prefixLength = key.indexOf("*");
      const bestPrefixLength = best?.key.indexOf("*") ?? -1;
      if (
        best === undefined ||
        prefixLength > bestPrefixLength ||
        (prefixLength === bestPrefixLength && key.length > best.key.length)
      )
        best = { key, star };
    }
    if (best === undefined) return undefined;
    const pattern = resolveTarget(map[best.key], conditions);
    target = typeof pattern === "string" ? pattern.replaceAll("*", best.star) : pattern;
  }
  if (typeof target !== "string") return undefined;
  const file = join(pkg.directory, normalizeTarget(target));
  return existsSync(file) ? file : undefined;
};

const filesUnder = (directory: string): ReadonlyArray<string> => {
  let entries: ReadonlyArray<string>;
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
};

const isInternal = (subpath: string) => subpath.split("/").includes("internal");

/**
 * Every importable script subpath of a package (`.` and `./...`), with wildcard keys expanded
 * against the files on disk. Subpaths produced by wildcards under an `internal` segment are
 * skipped, since they are implementation details rather than public entry points.
 */
export const subpaths = (
  pkg: Package,
  conditions: ReadonlyArray<string> = browserConditions,
): ReadonlyArray<string> => {
  const found = new Set<string>();
  for (const [key, value] of Object.entries(exportsMap(pkg.json))) {
    const keyWildcard = wildcard(key);
    if (keyWildcard === undefined) {
      if (key.includes("*")) continue;
      const file = resolveSubpath(pkg, key, conditions);
      if (file !== undefined && isScript(file)) found.add(key);
      continue;
    }
    const pattern = resolveTarget(value, conditions);
    if (typeof pattern !== "string") continue;
    const targetWildcard = wildcard(normalizeTarget(pattern));
    if (targetWildcard === undefined) continue;
    const base = join(pkg.directory, targetWildcard.prefix);
    const root = targetWildcard.prefix.endsWith("/") ? base : dirname(base);
    for (const file of filesUnder(root)) {
      const relativeFile = `./${toPosix(relative(pkg.directory, file))}`;
      const star = matchWildcard(`${targetWildcard.prefix}*${targetWildcard.suffix}`, relativeFile);
      if (star === undefined) continue;
      const subpath = `${keyWildcard.prefix}${star}${keyWildcard.suffix}`;
      if (isInternal(subpath) || !isScript(file)) continue;
      if (resolveSubpath(pkg, subpath, conditions) !== file) continue;
      found.add(subpath);
    }
  }
  return [...found].sort();
};

/** The bare specifier for a package subpath, e.g. `effect/Schema` for `./Schema`. */
export const specifier = (name: string, subpath: string) =>
  subpath === "." ? name : `${name}${subpath.slice(1)}`;

/**
 * The public specifier that exports `file`, such as `@macrograph/editor-ui/tokens.stylex`, or
 * `undefined` when no export key targets it.
 */
export const specifierForFile = (pkg: Package, file: string): string | undefined => {
  const relativeFile = `./${toPosix(relative(pkg.directory, file))}`;
  let wildcardMatch: string | undefined;
  for (const [key, value] of Object.entries(exportsMap(pkg.json))) {
    for (const target of leafTargets(value)) {
      const normalized = normalizeTarget(target);
      if (!key.includes("*")) {
        if (normalized === relativeFile) return specifier(pkg.name, key);
        continue;
      }
      const star = matchWildcard(normalized, relativeFile);
      const keyWildcard = wildcard(key);
      if (star !== undefined && keyWildcard !== undefined)
        wildcardMatch ??= specifier(pkg.name, `${keyWildcard.prefix}${star}${keyWildcard.suffix}`);
    }
  }
  return wildcardMatch;
};

export * as PackageExports from "./PackageExports.ts";
