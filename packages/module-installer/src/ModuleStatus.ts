import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";

import { ModuleId } from "@macrograph/module/ModuleId";

import type { InstallRecords } from "./InstallRecords.ts";

/**
 * What the installer knows about one installed module. The module host merges this into its
 * catalog entry: the installer owns `revoked`, `updateAvailable` and `trust`; the host owns
 * `stale` and `incompatibleInstalled`. Revoked modules are only flagged, never disabled.
 */
export interface Status {
  readonly id: ModuleId.Id;
  /** The installed version, i.e. the folder under `installed/<namespace>/<publisher>/<name>/`. */
  readonly version: string;
  /** Absolute path of the installed package folder. */
  readonly path: string;
  readonly flags: Pick<ModuleCatalog.Flags, "revoked" | "updateAvailable">;
  readonly trust: ModuleCatalog.Trust;
  /** The version an update would install, when one is available. */
  readonly updateVersion?: string;
}

export type Statuses = ReadonlyMap<ModuleId.Id, Status>;

/**
 * `registryTrusted` is the registry's current trust level, or `undefined` when the registry is
 * no longer configured (its releases then count as untrusted).
 */
export const fromRecord = (
  record: InstallRecords.Record,
  path: string,
  registryTrusted: boolean | undefined,
): Status => {
  const check = record.check;
  const current =
    check?.declaredTrust === undefined
      ? undefined
      : registryTrusted === true
        ? check.declaredTrust
        : "untrusted";
  const trust: ModuleCatalog.Trust = {
    registry: ModuleId.namespace(record.id),
    installed: record.trust,
    ...(current === undefined ? {} : { current }),
    ...(check?.reason === undefined ? {} : { reason: check.reason }),
  };
  return {
    id: record.id,
    version: record.version,
    path,
    flags: {
      revoked: check?.status === "revoked",
      updateAvailable: check?.updateVersion !== undefined,
    },
    trust,
    ...(check?.updateVersion === undefined ? {} : { updateVersion: check.updateVersion }),
  };
};

/**
 * Merges an installer status into a host catalog entry. Only applies when the host loaded the
 * installed copy that the status describes.
 */
export const applyToEntry = (
  entry: ModuleCatalog.Entry,
  status: Status | undefined,
): ModuleCatalog.Entry =>
  status === undefined || entry.source !== "installed" || entry.version !== status.version
    ? entry
    : { ...entry, flags: { ...entry.flags, ...status.flags }, trust: status.trust };

export * as ModuleStatus from "./ModuleStatus.ts";
