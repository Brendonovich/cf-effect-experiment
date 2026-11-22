import { Schema } from "effect";

import { Manifest } from "./Manifest.ts";
import { ModuleId } from "./ModuleId.ts";

export const SourceKind = Schema.Literals(["shipped", "installed", "local", "linked"]);
export type SourceKind = typeof SourceKind.Type;

export const Status = Schema.Literals(["discovered", "loading", "loaded", "failed", "disabled"]);
export type Status = typeof Status.Type;

export const Flags = Schema.Struct({
  stale: Schema.Boolean,
  revoked: Schema.Boolean,
  updateAvailable: Schema.Boolean,
  incompatibleInstalled: Schema.Boolean,
});
export type Flags = typeof Flags.Type;

export const noFlags: Flags = {
  stale: false,
  revoked: false,
  updateAvailable: false,
  incompatibleInstalled: false,
};

export const TrustLevel = Schema.Literals(["trusted", "untrusted"]);
export type TrustLevel = typeof TrustLevel.Type;

/** Trust for a release installed from a registry. Local modules have none. */
export const Trust = Schema.Struct({
  registry: ModuleId.Namespace,
  /** Trust recorded when the release was installed. */
  installed: TrustLevel,
  /** The registry's current trust, from the last registry check. */
  current: Schema.optionalKey(TrustLevel),
  /** The registry's reason for revoking or yanking the release. */
  reason: Schema.optionalKey(Schema.String),
});
export type Trust = typeof Trust.Type;

export const Ui = Schema.Struct({
  entryUrl: Schema.String,
  styleUrls: Schema.Array(Schema.String),
});
export type Ui = typeof Ui.Type;

export const Entry = Schema.Struct({
  id: ModuleId.Id,
  version: Manifest.Version,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  source: SourceKind,
  status: Status,
  flags: Flags,
  error: Schema.optionalKey(Schema.String),
  trust: Schema.optionalKey(Trust),
  iconUrl: Schema.optionalKey(Schema.String),
  ui: Schema.optionalKey(Ui),
});
export type Entry = typeof Entry.Type;

export const Catalog = Schema.Array(Entry);
export type Catalog = typeof Catalog.Type;

export * as ModuleCatalog from "./ModuleCatalog.ts";
