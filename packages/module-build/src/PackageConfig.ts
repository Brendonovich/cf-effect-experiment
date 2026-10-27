import { HostService } from "@macrograph/module/HostService";
import { Manifest } from "@macrograph/module/Manifest";
import { ModuleId } from "@macrograph/module/ModuleId";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Effect, Schema } from "effect";

/** A path relative to the module's package directory, e.g. `./src/Deployment.ts`. */
export const SourcePath = Schema.NonEmptyString;

export const Entries = Schema.Struct({
  /** Default-exports the module's deployment, or the bare module when it has no engine. */
  server: SourcePath,
  /** Default-exports `ModuleUI.make({ ... })`. */
  ui: Schema.optionalKey(SourcePath),
});
export type Entries = typeof Entries.Type;

export const BuildOptions = Schema.Struct({
  /**
   * Server specifiers left as `require(...)` calls even though they are neither shared nor
   * Node built-ins. The host's injected `require` must resolve them, otherwise they throw.
   */
  external: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
});
export type BuildOptions = typeof BuildOptions.Type;

/** The `macrograph` field of a module's `package.json`. */
export const Model = Schema.Struct({
  publisher: ModuleId.Publisher,
  name: ModuleId.Name,
  version: Manifest.Version,
  api: Manifest.Api,
  displayName: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  entries: Entries,
  /** Path relative to the package directory; copied into `assets/`. */
  icon: Schema.optionalKey(SourcePath),
  requires: Schema.optionalKey(Schema.Array(HostService.Id)),
  node: Schema.optionalKey(Schema.Array(Manifest.NodeBuiltin)),
  build: Schema.optionalKey(BuildOptions),
});
export type Model = typeof Model.Type;

const PackageJson = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  macrograph: Model,
});

export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("ModuleBuildInvalidConfig", {
  path: Schema.String,
  reason: Schema.String,
}) {}

/** Decodes the `macrograph` field from the contents of a `package.json`. */
export const decodePackageJson = (path: string, value: unknown) =>
  Schema.decodeUnknownEffect(PackageJson)(value).pipe(
    Effect.map((packageJson) => packageJson.macrograph),
    Effect.mapError((error) => new InvalidConfig({ path, reason: error.message })),
  );

const basename = (path: string) => path.split("/").at(-1) ?? path;

/** The icon's path inside the package folder. */
export const iconPath = (config: Model) =>
  config.icon === undefined
    ? undefined
    : `${ModulePackage.AssetsDirectory}/${basename(config.icon)}`;

/** Builds and validates `macrograph.json` for a package config. */
export const toManifest = (
  config: Model,
  options: { readonly ui: boolean; readonly styles: ReadonlyArray<string> },
) =>
  Manifest.decode({
    manifest: Manifest.FormatVersion,
    publisher: config.publisher,
    name: config.name,
    version: config.version,
    api: config.api,
    displayName: config.displayName,
    ...(config.description === undefined ? {} : { description: config.description }),
    server: ModulePackage.ServerEntry,
    ...(options.ui ? { ui: { entry: ModulePackage.UiEntry, styles: options.styles } } : {}),
    ...(config.icon === undefined ? {} : { icon: iconPath(config) }),
    ...(config.requires === undefined || config.requires.length === 0
      ? {}
      : { requires: config.requires }),
    ...(config.node === undefined || config.node.length === 0 ? {} : { node: config.node }),
  }).pipe(
    Effect.mapError(
      (error) => new InvalidConfig({ path: "macrograph.json", reason: error.message }),
    ),
  );

export * as PackageConfig from "./PackageConfig.ts";
