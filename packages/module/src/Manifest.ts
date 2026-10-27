import { Result, SemVer, Schema } from "effect";

import { HostService } from "./HostService.ts";
import { ModuleId } from "./ModuleId.ts";

export const FormatVersion = 1;
/** The host interface version modules built against this copy of `@macrograph/module` target. */
export const ApiVersion = 1;

export const isSemver = (value: string) => Result.isSuccess(SemVer.parse(value));

export const Version = Schema.String.check(
  Schema.makeFilter((value: string) => isSemver(value) || "Expected a semver version"),
);
export type Version = typeof Version.Type;

export const Api = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export type Api = typeof Api.Type;

/** A forward-slash path inside the package folder that cannot escape it. */
export const isPackagePath = (value: string) =>
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !/^[a-zA-Z]:/.test(value) &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== "..");

export const PackagePath = Schema.String.check(
  Schema.makeFilter(
    (value: string) => isPackagePath(value) || "Expected a relative path inside the package",
  ),
);
export type PackagePath = typeof PackagePath.Type;

const nodeBuiltinPattern = /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*$/;

/** A Node built-in module name without the `node:` prefix, e.g. `fs/promises`. */
export const NodeBuiltin = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      nodeBuiltinPattern.test(value) || "Expected a Node built-in name without the node: prefix",
  ),
);
export type NodeBuiltin = typeof NodeBuiltin.Type;

export const Ui = Schema.Struct({
  entry: PackagePath,
  styles: Schema.Array(PackagePath),
});
export type Ui = typeof Ui.Type;

export const Model = Schema.Struct({
  manifest: Schema.Literal(FormatVersion),
  publisher: ModuleId.Publisher,
  name: ModuleId.Name,
  version: Version,
  api: Api,
  displayName: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  server: PackagePath,
  ui: Schema.optionalKey(Ui),
  icon: Schema.optionalKey(PackagePath),
  requires: Schema.optionalKey(Schema.Array(HostService.Id)),
  node: Schema.optionalKey(Schema.Array(NodeBuiltin)),
});
export type Model = typeof Model.Type;

export const decode = Schema.decodeUnknownEffect(Model);
export const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Model));

/** The id a manifest loads under in the given namespace. */
export const moduleId = (manifest: Model, namespace: ModuleId.Namespace): ModuleId.Id =>
  ModuleId.make({ namespace, publisher: manifest.publisher, name: manifest.name });

/** Whether the server entry may import a `node:*` specifier. */
export const allowsNodeBuiltin = (manifest: Model, specifier: string) => {
  if (!specifier.startsWith("node:")) return false;
  const name = specifier.slice("node:".length);
  return (manifest.node ?? []).some((allowed) => name === allowed);
};

export * as Manifest from "./Manifest.ts";
