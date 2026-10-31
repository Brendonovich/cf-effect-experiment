export type Target = "server" | "browser";

/** Specifiers resolved to the host's own instances. A trailing `/*` matches every subpath. */
export const server: ReadonlyArray<string> = [
  "effect",
  "effect/*",
  "@macrograph/module",
  "@macrograph/module/*",
];

export const browser: ReadonlyArray<string> = [
  "solid-js",
  "solid-js/*",
  "@solidjs/web",
  "effect",
  "effect/*",
  "@macrograph/module",
  "@macrograph/module/*",
  "@macrograph/editor-ui",
  "@macrograph/editor-ui/*",
  "@tanstack/solid-query",
  "@stylexjs/stylex",
];

/** Subpaths matched by a wildcard above that are not browser-safe. */
export const browserExcluded: ReadonlyArray<string> = ["@macrograph/module/vite"];

export const specifiers = (target: Target) => (target === "server" ? server : browser);

const matches = (pattern: string, specifier: string) =>
  pattern.endsWith("/*")
    ? specifier.startsWith(pattern.slice(0, -1)) && specifier.length > pattern.length - 1
    : specifier === pattern;

export const isShared = (specifier: string, target: Target) =>
  specifiers(target).some((pattern) => matches(pattern, specifier)) &&
  (target === "server" || !browserExcluded.includes(specifier));

/** The package a shared specifier belongs to, e.g. `effect` for `effect/Schema`. */
export const packageName = (specifier: string) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
};

export * as SharedLibraries from "./SharedLibraries.ts";
