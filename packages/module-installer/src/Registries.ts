import type { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";

import { Protocol } from "@macrograph/module-registry/Protocol";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Schema } from "effect";

/** The official registry is built into the server; its public keys come from server configuration. */
export interface OfficialRegistryConfig {
  readonly url: string;
  /** Defaults to `ModuleId.OfficialNamespace`. */
  readonly namespace?: string;
  /** Defaults to "MacroGraph". */
  readonly displayName?: string;
  readonly keys: ReadonlyArray<Protocol.SigningKey>;
}

/** A registry an admin added. Its keys were pinned from its metadata when it was added. */
export const StoredRegistry = Schema.Struct({
  namespace: Protocol.RegistryNamespace,
  url: Schema.String,
  displayName: Schema.String,
  trusted: Schema.Boolean,
  keys: Schema.Array(Protocol.SigningKey),
  addedAt: Schema.String,
});
export type StoredRegistry = typeof StoredRegistry.Type;

/** `<dataDir>/modules/registries.json` */
export const File = Schema.Struct({
  version: Schema.Literal(1),
  /** The admin's trust override for the official registry. */
  officialTrusted: Schema.Boolean,
  registries: Schema.Array(StoredRegistry),
});
export type File = typeof File.Type;

export const emptyFile: File = { version: 1, officialTrusted: true, registries: [] };

/** A configured registry, official or added. */
export interface Registry {
  readonly namespace: string;
  readonly url: string;
  readonly displayName: string;
  readonly official: boolean;
  readonly trusted: boolean;
  readonly keys: ReadonlyArray<Protocol.SigningKey>;
}

export const official = (config: OfficialRegistryConfig, file: File): Registry => ({
  namespace: config.namespace ?? ModuleId.OfficialNamespace,
  url: config.url,
  displayName: config.displayName ?? "MacroGraph",
  official: true,
  trusted: file.officialTrusted,
  keys: config.keys,
});

export const all = (config: OfficialRegistryConfig, file: File): ReadonlyArray<Registry> => [
  official(config, file),
  ...file.registries.map((registry) => ({ ...registry, official: false })),
];

export const find = (config: OfficialRegistryConfig, file: File, namespace: string) =>
  all(config, file).find((registry) => registry.namespace === namespace);

export const toPayload = (registry: Registry): ModuleAdminRpc.Registry => ({
  namespace: registry.namespace,
  url: registry.url,
  displayName: registry.displayName,
  official: registry.official,
  trusted: registry.trusted,
  keys: registry.keys.map((key) => key.publicKey),
});

/**
 * A release's trust after applying its registry's trust level. A registry's own trust flags only
 * count when the registry is trusted; the official registry is trusted unless an admin says
 * otherwise. Every release from an untrusted registry is untrusted.
 */
export const effectiveTrust = (
  registry: Pick<Registry, "trusted">,
  declared: ModuleCatalog.TrustLevel,
): ModuleCatalog.TrustLevel => (registry.trusted ? declared : "untrusted");

export * as Registries from "./Registries.ts";
