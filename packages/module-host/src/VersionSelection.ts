import type { Manifest } from "@macrograph/module/Manifest";
import type { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";

import { Option, SemVer } from "effect";

import type { ModuleSources } from "./ModuleSources.ts";

export interface Selection {
  /** The copy to load, if any is usable. */
  readonly chosen: Option.Option<ModuleSources.Copy>;
  /** The manifest to describe the module with: the chosen copy's, or the best unusable one. */
  readonly manifest: Option.Option<Manifest.Model>;
  /** The copy the manifest above came from, for its source and path. */
  readonly described: Option.Option<ModuleSources.Copy>;
  readonly copies: ReadonlyArray<ModuleAdminRpc.ModuleCopy>;
  /** An installed copy newer than the chosen one exists but targets an unsupported `api`. */
  readonly incompatibleInstalled: boolean;
  /** Why nothing could be chosen. */
  readonly error: Option.Option<string>;
}

const compareVersions = (left: string, right: string) =>
  SemVer.Order(SemVer.parseUnsafe(left), SemVer.parseUnsafe(right));

/** Higher version first; on a tie the shipped copy wins, since it's what the server was built with. */
const byPreference = (left: ModuleSources.Copy, right: ModuleSources.Copy) => {
  const order = compareVersions(right.manifest.version, left.manifest.version);
  if (order !== 0) return order;
  return (left.source === "shipped" ? 0 : 1) - (right.source === "shipped" ? 0 : 1);
};

const describeApis = (supported: ReadonlySet<number>) =>
  supported.size === 0 ? "none" : [...supported].sort((a, b) => a - b).join(", ");

const incompatibleMessage = (copy: ModuleSources.Copy, supported: ReadonlySet<number>) =>
  `${copy.source} copy ${copy.manifest.version} targets api ${copy.manifest.api}; this host supports api ${describeApis(supported)}`;

/**
 * Picks the copy of a module to load:
 * 1. a dev link always wins (and fails rather than falling back if it's incompatible);
 * 2. otherwise the highest version among shipped and installed copies whose `api` is supported;
 * 3. an incompatible installed copy newer than that sets `incompatibleInstalled`.
 */
export const select = (
  group: ModuleSources.Group,
  supportedApis: ReadonlySet<number>,
): Selection => {
  const compatible = (copy: ModuleSources.Copy) => supportedApis.has(copy.manifest.api);
  const copies = group.copies.map(
    (copy): ModuleAdminRpc.ModuleCopy => ({
      source: copy.source,
      version: copy.manifest.version,
      api: copy.manifest.api,
      compatible: compatible(copy),
      path: Option.getOrElse(copy.root, () => "<static>"),
    }),
  );
  const result = (
    fields: Pick<Selection, "chosen" | "described" | "incompatibleInstalled" | "error">,
  ): Selection => ({
    ...fields,
    manifest: Option.map(fields.described, (copy) => copy.manifest),
    copies,
  });

  const invalidError = () =>
    Option.some(group.invalid.map((copy) => `${copy.root}: ${copy.error}`).join("\n"));

  const preferred = (source: ModuleSources.Copy["source"]) =>
    group.copies.filter((copy) => copy.source === source).sort(byPreference)[0];

  // A dev link or a local folder is the only copy considered when present.
  const exclusive = preferred("linked") ?? preferred("local");
  const exclusiveInvalid =
    group.invalid.find((copy) => copy.source === "linked") ??
    (exclusive === undefined ? group.invalid.find((copy) => copy.source === "local") : undefined);
  if (exclusive === undefined && exclusiveInvalid !== undefined)
    return result({
      chosen: Option.none(),
      described: Option.fromNullishOr(preferred("shipped") ?? preferred("installed")),
      incompatibleInstalled: false,
      error: Option.some(`${exclusiveInvalid.root}: ${exclusiveInvalid.error}`),
    });
  if (exclusive !== undefined)
    return result({
      chosen: compatible(exclusive) ? Option.some(exclusive) : Option.none(),
      described: Option.some(exclusive),
      incompatibleInstalled: false,
      error: compatible(exclusive)
        ? Option.none()
        : Option.some(incompatibleMessage(exclusive, supportedApis)),
    });

  const pool = group.copies
    .filter((copy) => copy.source === "shipped" || copy.source === "installed")
    .sort(byPreference);
  const chosen = pool.find(compatible);
  const incompatibleInstalled = pool.some(
    (copy) =>
      copy.source === "installed" &&
      !compatible(copy) &&
      (chosen === undefined || compareVersions(copy.manifest.version, chosen.manifest.version) > 0),
  );
  if (chosen !== undefined)
    return result({
      chosen: Option.some(chosen),
      described: Option.some(chosen),
      incompatibleInstalled,
      error: Option.none(),
    });
  const best = pool[0];
  return result({
    chosen: Option.none(),
    described: Option.fromNullishOr(best),
    incompatibleInstalled,
    error:
      best === undefined
        ? invalidError()
        : Option.some(
            `No compatible copy: ${pool.map((copy) => incompatibleMessage(copy, supportedApis)).join("; ")}`,
          ),
  });
};

export * as VersionSelection from "./VersionSelection.ts";
