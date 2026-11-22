import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import { Manifest } from "./Manifest.ts";
import { ModuleCatalog } from "./ModuleCatalog.ts";
import { ModuleId } from "./ModuleId.ts";

export class ModuleNotFound extends Schema.TaggedError<ModuleNotFound>()("ModuleNotFound", {
  id: Schema.String,
}) {}

export class ModuleNotLoaded extends Schema.TaggedError<ModuleNotLoaded>()("ModuleNotLoaded", {
  id: ModuleId.Id,
  status: ModuleCatalog.Status,
  error: Schema.optionalKey(Schema.String),
}) {}

export class UntrustedConfirmationRequired extends Schema.TaggedError<UntrustedConfirmationRequired>()(
  "UntrustedConfirmationRequired",
  {
    id: ModuleId.Id,
    version: Manifest.Version,
    registry: ModuleId.Namespace,
    requires: Schema.Array(Schema.String),
    node: Schema.Array(Schema.String),
    native: Schema.Array(Schema.String),
  },
) {}

export class IncompatibleModule extends Schema.TaggedError<IncompatibleModule>()(
  "IncompatibleModule",
  {
    id: ModuleId.Id,
    version: Manifest.Version,
    api: Schema.Int,
    supported: Schema.Array(Schema.Int),
  },
) {}

export class ReleaseNotFound extends Schema.TaggedError<ReleaseNotFound>()("ReleaseNotFound", {
  id: ModuleId.Id,
  version: Schema.optionalKey(Schema.String),
}) {}

export class ReleaseUnavailable extends Schema.TaggedError<ReleaseUnavailable>()(
  "ReleaseUnavailable",
  {
    id: ModuleId.Id,
    version: Manifest.Version,
    status: Schema.Literals(["yanked", "revoked"]),
    reason: Schema.optionalKey(Schema.String),
  },
) {}

export class VerificationFailed extends Schema.TaggedError<VerificationFailed>()(
  "VerificationFailed",
  {
    id: ModuleId.Id,
    version: Manifest.Version,
    check: Schema.Literals(["integrity", "signature", "manifest"]),
    message: Schema.String,
  },
) {}

export class InstallFailed extends Schema.TaggedError<InstallFailed>()("InstallFailed", {
  id: ModuleId.Id,
  message: Schema.String,
}) {}

export class NotUninstallable extends Schema.TaggedError<NotUninstallable>()("NotUninstallable", {
  id: ModuleId.Id,
  reason: Schema.String,
}) {}

export class RegistryNotFound extends Schema.TaggedError<RegistryNotFound>()("RegistryNotFound", {
  namespace: Schema.String,
}) {}

export class RegistryConflict extends Schema.TaggedError<RegistryConflict>()("RegistryConflict", {
  namespace: ModuleId.Namespace,
  url: Schema.String,
}) {}

export class RegistryError extends Schema.TaggedError<RegistryError>()("RegistryError", {
  namespace: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}

export class InvalidLink extends Schema.TaggedError<InvalidLink>()("InvalidLink", {
  path: Schema.String,
  message: Schema.String,
}) {}

export const ModuleCopy = Schema.Struct({
  source: ModuleCatalog.SourceKind,
  version: Manifest.Version,
  api: Manifest.Api,
  compatible: Schema.Boolean,
  path: Schema.String,
});
export type ModuleCopy = typeof ModuleCopy.Type;

export const ModuleDetails = Schema.Struct({
  entry: ModuleCatalog.Entry,
  enabled: Schema.Boolean,
  path: Schema.optionalKey(Schema.String),
  contentHash: Schema.optionalKey(Schema.String),
  manifest: Schema.optionalKey(Manifest.Model),
  copies: Schema.Array(ModuleCopy),
});
export type ModuleDetails = typeof ModuleDetails.Type;

export const Registry = Schema.Struct({
  namespace: ModuleId.Namespace,
  url: Schema.String,
  displayName: Schema.String,
  official: Schema.Boolean,
  trusted: Schema.Boolean,
  /** Base64 Ed25519 public keys pinned when the registry was added. */
  keys: Schema.Array(Schema.String),
});
export type Registry = typeof Registry.Type;

export const RegistrySearchResult = Schema.Struct({
  id: ModuleId.Id,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  latestVersion: Manifest.Version,
  installedVersion: Schema.optionalKey(Manifest.Version),
});
export type RegistrySearchResult = typeof RegistrySearchResult.Type;

export const RegistryRelease = Schema.Struct({
  version: Manifest.Version,
  api: Manifest.Api,
  compatible: Schema.Boolean,
  publishedAt: Schema.String,
  /** Trust after applying the registry's trust level. */
  trust: ModuleCatalog.TrustLevel,
  status: Schema.Literals(["active", "yanked", "revoked"]),
  reason: Schema.optionalKey(Schema.String),
  requires: Schema.Array(Schema.String),
  node: Schema.Array(Schema.String),
  /** Native addons the release ships; they run with the server's full privileges. */
  native: Schema.Array(Schema.String),
});
export type RegistryRelease = typeof RegistryRelease.Type;

export const RegistryPackage = Schema.Struct({
  id: ModuleId.Id,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  installedVersion: Schema.optionalKey(Manifest.Version),
  releases: Schema.Array(RegistryRelease),
});
export type RegistryPackage = typeof RegistryPackage.Type;

const InstallErrors = [
  RegistryNotFound,
  RegistryError,
  ReleaseNotFound,
  ReleaseUnavailable,
  IncompatibleModule,
  UntrustedConfirmationRequired,
  VerificationFailed,
  InstallFailed,
] as const;

export class GetModules extends Rpc.make("GetModules", {
  payload: {},
  success: ModuleCatalog.Catalog,
}) {}

export class ListModules extends Rpc.make("ListModules", {
  payload: {},
  success: Schema.Array(ModuleDetails),
}) {}

export class ReloadModule extends Rpc.make("ReloadModule", {
  payload: { id: ModuleId.Id },
  success: ModuleCatalog.Entry,
  error: ModuleNotFound,
}) {}

export class RescanModules extends Rpc.make("RescanModules", {
  payload: {},
  success: ModuleCatalog.Catalog,
}) {}

export class SetModuleEnabled extends Rpc.make("SetModuleEnabled", {
  payload: { id: ModuleId.Id, enabled: Schema.Boolean },
  success: ModuleCatalog.Entry,
  error: ModuleNotFound,
}) {}

export class ListRegistries extends Rpc.make("ListRegistries", {
  payload: {},
  success: Schema.Array(Registry),
}) {}

export class AddRegistry extends Rpc.make("AddRegistry", {
  payload: { url: Schema.String },
  success: Registry,
  error: Schema.Union([RegistryConflict, RegistryError]),
}) {}

export class RemoveRegistry extends Rpc.make("RemoveRegistry", {
  payload: { namespace: ModuleId.Namespace },
  error: Schema.Union([RegistryNotFound, RegistryError]),
}) {}

export class SetRegistryTrusted extends Rpc.make("SetRegistryTrusted", {
  payload: { namespace: ModuleId.Namespace, trusted: Schema.Boolean },
  success: Registry,
  error: RegistryNotFound,
}) {}

export class SearchRegistry extends Rpc.make("SearchRegistry", {
  payload: { namespace: Schema.optionalKey(ModuleId.Namespace), query: Schema.String },
  success: Schema.Array(RegistrySearchResult),
  error: Schema.Union([RegistryNotFound, RegistryError]),
}) {}

export class GetRegistryPackage extends Rpc.make("GetRegistryPackage", {
  payload: { id: ModuleId.Id },
  success: RegistryPackage,
  error: Schema.Union([RegistryNotFound, ModuleNotFound, RegistryError]),
}) {}

export class InstallModule extends Rpc.make("InstallModule", {
  payload: {
    id: ModuleId.Id,
    version: Schema.optionalKey(Manifest.Version),
    acknowledgeUntrusted: Schema.Boolean,
  },
  success: ModuleCatalog.Entry,
  error: Schema.Union([...InstallErrors, ModuleNotFound]),
}) {}

export class UpdateModule extends Rpc.make("UpdateModule", {
  payload: {
    id: ModuleId.Id,
    version: Schema.optionalKey(Manifest.Version),
    acknowledgeUntrusted: Schema.Boolean,
  },
  success: ModuleCatalog.Entry,
  error: Schema.Union([...InstallErrors, ModuleNotFound]),
}) {}

export class UninstallModule extends Rpc.make("UninstallModule", {
  payload: { id: ModuleId.Id },
  error: Schema.Union([ModuleNotFound, NotUninstallable]),
}) {}

export class CheckForUpdates extends Rpc.make("CheckForUpdates", {
  payload: {},
  success: ModuleCatalog.Catalog,
}) {}

export class LinkModule extends Rpc.make("LinkModule", {
  payload: { id: ModuleId.Id, path: Schema.String },
  success: ModuleCatalog.Entry,
  error: InvalidLink,
}) {}

export class UnlinkModule extends Rpc.make("UnlinkModule", {
  payload: { id: ModuleId.Id },
  error: ModuleNotFound,
}) {}

export const ModuleAdminRpcs = RpcGroup.make(
  GetModules,
  ListModules,
  ReloadModule,
  RescanModules,
  SetModuleEnabled,
  ListRegistries,
  AddRegistry,
  RemoveRegistry,
  SetRegistryTrusted,
  SearchRegistry,
  GetRegistryPackage,
  InstallModule,
  UpdateModule,
  UninstallModule,
  CheckForUpdates,
  LinkModule,
  UnlinkModule,
);
export type ModuleAdminRpcs = RpcGroup.Rpcs<typeof ModuleAdminRpcs>;

const viewerRpcs: ReadonlySet<string> = new Set(["GetModules"]);

/** Every admin RPC except reading the catalog requires admin access. */
export const requiresAdmin = (operation: string) => !viewerRpcs.has(operation);

/** Broadcast on the editor WebSocket when the catalog changes; clients refetch `GetModules`. */
export const ModulesChanged = Schema.TaggedStruct("ModulesChanged", {});
export type ModulesChanged = typeof ModulesChanged.Type;

export * as ModuleAdminRpc from "./ModuleAdminRpc.ts";
