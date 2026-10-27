import { Manifest } from "@macrograph/module/Manifest";
import { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Schema } from "effect";

import { Integrity } from "./Integrity.ts";

export const ProtocolVersion = 1;

export const WellKnownPath = "/.well-known/macrograph-registry.json";
export const IndexPath = "/v1/index.json";
export const SearchPath = "/v1/search";
export const packagePath = (publisher: string, name: string) =>
  `/v1/packages/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}.json`;

/** A namespace a registry may declare: a domain, never `local`. */
export const RegistryNamespace = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      ModuleId.isRegistryNamespace(value) || "Expected a domain name that is not reserved",
  ),
);
export type RegistryNamespace = typeof RegistryNamespace.Type;

export const SigningKey = Schema.Struct({
  id: Schema.NonEmptyString,
  algorithm: Schema.Literal("Ed25519"),
  /** Base64 raw 32-byte public key. */
  publicKey: Schema.String,
});
export type SigningKey = typeof SigningKey.Type;

/** `/.well-known/macrograph-registry.json` */
export const Metadata = Schema.Struct({
  protocol: Schema.Literal(ProtocolVersion),
  namespace: RegistryNamespace,
  displayName: Schema.String,
  keys: Schema.Array(SigningKey),
});
export type Metadata = typeof Metadata.Type;

export const IndexEntry = Schema.Struct({
  publisher: ModuleId.Publisher,
  name: ModuleId.Name,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  latestVersion: Manifest.Version,
});
export type IndexEntry = typeof IndexEntry.Type;

/** `/v1/index.json` */
export const Index = Schema.Struct({
  packages: Schema.Array(IndexEntry),
});
export type Index = typeof Index.Type;

export const ReleaseStatus = Schema.Literals(["active", "yanked", "revoked"]);
export type ReleaseStatus = typeof ReleaseStatus.Type;

export const Trust = ModuleCatalog.TrustLevel;
export type Trust = ModuleCatalog.TrustLevel;

export const Signature = Schema.Struct({
  keyId: Schema.NonEmptyString,
  /** Base64 Ed25519 signature over the canonical JSON of the release's signed record. */
  value: Schema.String,
});
export type Signature = typeof Signature.Type;

export const Release = Schema.Struct({
  version: Manifest.Version,
  api: Manifest.Api,
  publishedAt: Schema.String,
  manifest: Manifest.Model,
  tarball: Schema.String,
  integrity: Integrity.Hash,
  trust: Trust,
  status: ReleaseStatus,
  reason: Schema.optionalKey(Schema.String),
  signature: Signature,
});
export type Release = typeof Release.Type;

/** `/v1/packages/<publisher>/<name>.json` */
export const Package = Schema.Struct({
  publisher: ModuleId.Publisher,
  name: ModuleId.Name,
  releases: Schema.Array(Release),
});
export type Package = typeof Package.Type;

/** The fields of a release covered by its signature. Changing trust or status means re-signing. */
export const SignedRecord = Schema.Struct({
  namespace: RegistryNamespace,
  publisher: ModuleId.Publisher,
  name: ModuleId.Name,
  version: Manifest.Version,
  api: Manifest.Api,
  integrity: Integrity.Hash,
  trust: Trust,
  status: ReleaseStatus,
});
export type SignedRecord = typeof SignedRecord.Type;

export const signedRecord = (
  namespace: string,
  pkg: { readonly publisher: string; readonly name: string },
  release: Pick<Release, "version" | "api" | "integrity" | "trust" | "status">,
): SignedRecord => ({
  namespace,
  publisher: pkg.publisher,
  name: pkg.name,
  version: release.version,
  api: release.api,
  integrity: release.integrity,
  trust: release.trust,
  status: release.status,
});

export const decodeMetadata = Schema.decodeUnknownEffect(Metadata);
export const decodeIndex = Schema.decodeUnknownEffect(Index);
export const decodePackage = Schema.decodeUnknownEffect(Package);

export * as Protocol from "./Protocol.ts";
