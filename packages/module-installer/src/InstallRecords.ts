import { Integrity } from "@macrograph/module-registry/Integrity";
import { Protocol } from "@macrograph/module-registry/Protocol";
import { Manifest } from "@macrograph/module/Manifest";
import { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Schema } from "effect";
import { join } from "node:path";

/** Who acknowledged installing an untrusted release, and when. */
export const Confirmation = Schema.Struct({
  actor: Schema.String,
  at: Schema.String,
});
export type Confirmation = typeof Confirmation.Type;

/** The result of the last registry check for an installed release. */
export const Check = Schema.Struct({
  checkedAt: Schema.String,
  /** The trust the registry declares for the release today, before applying its trust level. */
  declaredTrust: Schema.optionalKey(ModuleCatalog.TrustLevel),
  status: Schema.optionalKey(Protocol.ReleaseStatus),
  reason: Schema.optionalKey(Schema.String),
  /** The newest active release this host can run, when newer than the installed one. */
  updateVersion: Schema.optionalKey(Manifest.Version),
  /** Why the check couldn't complete. Earlier results are kept. */
  error: Schema.optionalKey(Schema.String),
});
export type Check = typeof Check.Type;

export const Record = Schema.Struct({
  id: ModuleId.Id,
  version: Manifest.Version,
  api: Manifest.Api,
  integrity: Integrity.Hash,
  /** Trust at install time, after applying the registry's trust level. */
  trust: ModuleCatalog.TrustLevel,
  /** Trust the registry declared for the release at install time. */
  declaredTrust: ModuleCatalog.TrustLevel,
  installedBy: Schema.String,
  installedAt: Schema.String,
  /** Present when the release was untrusted and an admin acknowledged it. */
  confirmation: Schema.optionalKey(Confirmation),
  check: Schema.optionalKey(Check),
});
export type Record = typeof Record.Type;

/** `<dataDir>/modules/installs.json` */
export const File = Schema.Struct({
  version: Schema.Literal(1),
  installs: Schema.Array(Record),
});
export type File = typeof File.Type;

export const emptyFile: File = { version: 1, installs: [] };

export const modulesDirectory = (dataDir: string) => join(dataDir, "modules");
export const filePath = (dataDir: string) => join(modulesDirectory(dataDir), "installs.json");
export const registriesPath = (dataDir: string) =>
  join(modulesDirectory(dataDir), "registries.json");
export const installedDirectory = (dataDir: string) => join(modulesDirectory(dataDir), "installed");
export const stagingDirectory = (dataDir: string) => join(modulesDirectory(dataDir), ".staging");

/** `<dataDir>/modules/installed/<namespace>/<publisher>/<name>` */
export const moduleDirectory = (dataDir: string, id: ModuleId.Id) => {
  const parts = ModuleId.parts(id);
  return join(installedDirectory(dataDir), parts.namespace, parts.publisher, parts.name);
};

/** `<dataDir>/modules/installed/<namespace>/<publisher>/<name>/<version>` */
export const versionDirectory = (dataDir: string, id: ModuleId.Id, version: string) =>
  join(moduleDirectory(dataDir, id), version);

export const find = (file: File, id: ModuleId.Id) =>
  file.installs.find((record) => record.id === id);

export const upsert = (file: File, record: Record): File => ({
  ...file,
  installs: [...file.installs.filter((existing) => existing.id !== record.id), record],
});

export const remove = (file: File, id: ModuleId.Id): File => ({
  ...file,
  installs: file.installs.filter((existing) => existing.id !== id),
});

export * as InstallRecords from "./InstallRecords.ts";
