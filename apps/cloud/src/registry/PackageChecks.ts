import { Checks } from "@macrograph/module-build/Checks";
import { Manifest } from "@macrograph/module/Manifest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Effect, Schema } from "effect";

import type { Entry } from "./Tarball.ts";

import { InvalidPackage } from "./Errors.ts";

/** A module package unpacked in memory. Paths are relative to the package folder. */
export interface PackageContents {
  readonly manifest: Manifest.Model;
  readonly files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

/**
 * A publish-time check. It returns readable problems; an empty array means the package passes.
 * Checks must not throw.
 */
export interface Check {
  readonly name: string;
  readonly run: (contents: PackageContents) => Effect.Effect<ReadonlyArray<string>>;
}

export interface Options {
  readonly supportedApi: ReadonlyArray<number>;
  /** Extra checks run after the built-in ones, such as {@link bundleChecks}. */
  readonly checks: ReadonlyArray<Check>;
}

/** Manifest and layout issues are already covered by {@link apiCheck} and {@link layoutCheck}. */
const coveredIssues: ReadonlySet<Checks.IssueCode> = new Set([
  "invalid-manifest",
  "missing-file",
  "unexpected-file",
]);

const externalsPolicy =
  "Published modules may only require shared libraries, and the node built-ins and native addons declared in macrograph.json; bundle every other dependency";

const describeIssue = (issue: Checks.Issue) => {
  const location = issue.path === undefined ? "" : `${issue.path}: `;
  const policy = issue.code === "unresolvable-require" ? `. ${externalsPolicy}` : "";
  return `${location}${issue.message}${policy}`;
};

/**
 * The bundle checks from `@macrograph/module-build`: valid syntax, no top-level await, no bundled
 * copies of shared libraries, only resolvable `require`s and declared node built-ins, UI imports
 * limited to shared browser libraries, native addons under `native/` that are declared, target
 * a known platform and are real binaries, and size limits.
 */
export const bundleChecks: ReadonlyArray<Check> = [
  {
    name: "bundle",
    run: ({ files }) =>
      Effect.sync(() => {
        const { issues } = Checks.checkPackage(
          [...files].map(([path, contents]) => ({ path, contents })),
        );
        return Checks.errors(issues)
          .filter((issue) => !coveredIssues.has(issue.code))
          .map(describeIssue);
      }),
  },
];

const extraTopLevelFiles = /^(?:README(?:\.md)?|LICEN[CS]E(?:\.md|\.txt)?|CHANGELOG\.md)$/i;

export const apiCheck = (supportedApi: ReadonlyArray<number>): Check => ({
  name: "api",
  run: ({ manifest }) =>
    Effect.succeed(
      supportedApi.includes(manifest.api)
        ? []
        : [
            `Host interface version ${manifest.api} is not supported (supported: ${supportedApi.join(", ")})`,
          ],
    ),
});

/** The folder layout from the package format: manifest, server entry, `ui/`, `assets/`, `native/`. */
export const layoutCheck: Check = {
  name: "layout",
  run: ({ manifest, files }) =>
    Effect.sync(() => {
      const problems: Array<string> = [];
      if (manifest.server !== ModulePackage.ServerEntry)
        problems.push(`The server entry must be ${ModulePackage.ServerEntry}`);
      const referenced = [
        manifest.server,
        ...(manifest.ui === undefined ? [] : [manifest.ui.entry, ...manifest.ui.styles]),
        ...(manifest.icon === undefined ? [] : [manifest.icon]),
      ];
      for (const path of referenced)
        if (!files.has(path)) problems.push(`${path} is referenced by the manifest but missing`);
      if (manifest.ui !== undefined) {
        for (const path of [manifest.ui.entry, ...manifest.ui.styles])
          if (!path.startsWith(`${ModulePackage.UiDirectory}/`))
            problems.push(`${path} must be inside ${ModulePackage.UiDirectory}/`);
      }
      for (const path of files.keys()) {
        const inUi = path.startsWith(`${ModulePackage.UiDirectory}/`);
        const inAssets = path.startsWith(`${ModulePackage.AssetsDirectory}/`);
        const isNative = ModulePackage.parseNativePath(path) !== undefined;
        const allowed =
          path === ModulePackage.ManifestFile ||
          path === manifest.server ||
          inAssets ||
          isNative ||
          (inUi && manifest.ui !== undefined) ||
          (!path.includes("/") && extraTopLevelFiles.test(path));
        if (!allowed) problems.push(`${path} is not part of the module package layout`);
      }
      return problems;
    }),
};

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest.Model));
const decoder = new TextDecoder("utf-8", { fatal: true });

const invalid = (problems: ReadonlyArray<string>) =>
  new InvalidPackage({ message: "The package failed publish checks", problems });

/** Reads the manifest and runs every check over an unpacked tarball. */
export const inspect = (
  entries: ReadonlyArray<Entry>,
  options: Options,
): Effect.Effect<PackageContents, InvalidPackage> =>
  Effect.gen(function* () {
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const pathProblems: Array<string> = [];
    for (const entry of entries) {
      if (!Manifest.isPackagePath(entry.path))
        pathProblems.push(`${entry.path} is not a relative path inside the package`);
      else if (files.has(entry.path)) pathProblems.push(`${entry.path} appears more than once`);
      else files.set(entry.path, entry.bytes);
    }
    if (pathProblems.length > 0) return yield* invalid(pathProblems);

    const manifestBytes = files.get(ModulePackage.ManifestFile);
    if (manifestBytes === undefined)
      return yield* invalid([`${ModulePackage.ManifestFile} is missing`]);
    const manifest = yield* Effect.try({
      try: () => decoder.decode(manifestBytes),
      catch: () => invalid([`${ModulePackage.ManifestFile} is not UTF-8`]),
    }).pipe(
      Effect.flatMap((text) =>
        decodeManifest(text).pipe(
          Effect.mapError((error) =>
            invalid([`${ModulePackage.ManifestFile} is invalid: ${error.message}`]),
          ),
        ),
      ),
    );

    const contents: PackageContents = { manifest, files };
    const checks = [apiCheck(options.supportedApi), layoutCheck, ...options.checks];
    const problems = yield* Effect.forEach(checks, (check) =>
      check
        .run(contents)
        .pipe(Effect.map((issues) => issues.map((issue) => `${check.name}: ${issue}`))),
    );
    const flat = problems.flat();
    if (flat.length > 0) return yield* invalid(flat);
    return contents;
  });
