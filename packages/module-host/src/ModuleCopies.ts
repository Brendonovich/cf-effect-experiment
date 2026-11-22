import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";

import { Manifest } from "@macrograph/module/Manifest";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Option } from "effect";

/**
 * A module that is already imported, for tests and for hosts that can't load from disk (cloud,
 * playground). It counts as a shipped copy unless `source` says otherwise.
 */
export interface StaticModule {
  readonly manifest: Manifest.Model;
  /** The server entry's default export: a deployment, or a module without an engine. */
  readonly deployment: unknown;
  /** Defaults to the official namespace. */
  readonly namespace?: ModuleId.Namespace;
  readonly source?: ModuleCatalog.SourceKind;
  /** Folder its `ui/` and `assets/` are served from, if any. Only hosts with a filesystem use it. */
  readonly root?: string;
  /** Defaults to the folder's hash if `root` is set, else a hash of the id and version. */
  readonly contentHash?: string;
}

/** One loadable copy of a module. */
export interface Copy {
  readonly id: ModuleId.Id;
  readonly source: ModuleCatalog.SourceKind;
  readonly root: Option.Option<string>;
  readonly manifest: Manifest.Model;
  /** Set for static modules, which skip evaluation. */
  readonly static: Option.Option<{
    readonly deployment: unknown;
    readonly contentHash: Option.Option<string>;
  }>;
}

/** A folder that looks like a copy of a module but couldn't be read. */
export interface InvalidCopy {
  readonly id: ModuleId.Id;
  readonly source: ModuleCatalog.SourceKind;
  readonly root: string;
  readonly error: string;
}

export interface Group {
  readonly copies: ReadonlyArray<Copy>;
  readonly invalid: ReadonlyArray<InvalidCopy>;
}

export type Groups = ReadonlyMap<ModuleId.Id, Group>;

export const staticCopy = (module: StaticModule): Copy => ({
  id: Manifest.moduleId(module.manifest, module.namespace ?? ModuleId.OfficialNamespace),
  source: module.source ?? "shipped",
  root: Option.fromNullishOr(module.root),
  manifest: module.manifest,
  static: Option.some({
    deployment: module.deployment,
    contentHash: Option.fromNullishOr(module.contentHash),
  }),
});

/** Groups copies found in any source by module id. */
export const group = (found: ReadonlyArray<Copy | InvalidCopy>): Groups => {
  const groups = new Map<ModuleId.Id, { copies: Array<Copy>; invalid: Array<InvalidCopy> }>();
  for (const item of found) {
    const entry = groups.get(item.id) ?? { copies: [], invalid: [] };
    if ("error" in item) entry.invalid.push(item);
    else entry.copies.push(item);
    groups.set(item.id, entry);
  }
  return groups;
};

export * as ModuleCopies from "./ModuleCopies.ts";
