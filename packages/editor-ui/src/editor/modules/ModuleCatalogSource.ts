import type { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";

import { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import { Effect, type Stream } from "effect";

/**
 * A catalog entry as the editor sees it. Bundled hosts key modules by their package id until every
 * module has a full `namespace/publisher/name` id, so the id is not required to be a `ModuleId`.
 */
export type ModuleCatalogEntry = Omit<ModuleCatalog.Entry, "id"> & { readonly id: string };

export interface ModuleCatalogPackage {
  readonly id: string;
  readonly name: string;
}

/** Where the editor reads the module catalog from for one connection. */
export interface ModuleCatalogSource {
  /** Fetches the catalog. Receives the packages the editor fetched on the same connection. */
  readonly fetch: (
    packages: ReadonlyArray<ModuleCatalogPackage>,
  ) => Effect.Effect<ReadonlyArray<ModuleCatalogEntry>, unknown>;
  /** Emits whenever the catalog should be fetched again, such as on `ModulesChanged`. */
  readonly changes?: Stream.Stream<unknown, unknown>;
}

export const packageEntry = (pkg: ModuleCatalogPackage): ModuleCatalogEntry => ({
  id: pkg.id,
  version: "0.0.0",
  displayName: pkg.name,
  source: "shipped",
  status: "loaded",
  flags: ModuleCatalog.noFlags,
});

/** A static catalog of the modules the host bundles, one entry per loaded package. */
export const fromPackages: ModuleCatalogSource = {
  fetch: (packages) => Effect.succeed(packages.map(packageEntry)),
};

/** A static catalog with fixed entries. */
export const fromEntries = (entries: ReadonlyArray<ModuleCatalogEntry>): ModuleCatalogSource => ({
  fetch: () => Effect.succeed(entries),
});

/** The host's catalog, read through the `GetModules` admin RPC and refetched on `ModulesChanged`. */
export const fromRpc = (options: {
  readonly client: {
    readonly GetModules: (
      payload: Record<string, never>,
    ) => Effect.Effect<ModuleCatalog.Catalog, unknown>;
  };
  readonly changes?: Stream.Stream<ModuleAdminRpc.ModulesChanged, unknown>;
}): ModuleCatalogSource => ({
  fetch: () => options.client.GetModules({}),
  ...(options.changes === undefined ? {} : { changes: options.changes }),
});

export * as ModuleCatalogSource from "./ModuleCatalogSource.ts";
