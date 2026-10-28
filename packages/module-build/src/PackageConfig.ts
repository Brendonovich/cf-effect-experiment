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

/** Marks where a native addon template takes the target, e.g. `linux-x64-musl`. */
export const TargetPlaceholder = "{target}";

export const BuildOptions = Schema.Struct({
  /**
   * Native addons by name, each mapped to a path template for its prebuilt binaries, e.g.
   * `"@julusian/midi/prebuilds/midi-{target}/node-napi-v7.node"`. The leading package is
   * resolved from the module's directory and `{target}` is replaced by every known target; each
   * binary that exists is copied to `native/<name>/<target>.node`. The server entry loads it with
   * `require("macrograph:native/<name>")`.
   */
  native: Schema.optionalKey(
    Schema.Record(
      Manifest.NativeAddon,
      Schema.NonEmptyString.check(
        Schema.makeFilter(
          (value: string) =>
            value.includes(TargetPlaceholder) || `Expected a path containing ${TargetPlaceholder}`,
        ),
      ),
    ),
  ),
  /**
   * Replaces files inside dependencies in the server bundle, keyed by `<package>/<file>` (the
   * file doesn't have to be exported) and mapped to a path relative to the module's directory.
   * Use it to swap a dependency's native loader for one that requires `macrograph:native/<name>`.
   */
  alias: Schema.optionalKey(Schema.Record(Schema.NonEmptyString, SourcePath)),
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

/** The native addons a config builds, sorted by name. */
export const nativeAddons = (config: Model): ReadonlyArray<string> =>
  Object.keys(config.build?.native ?? {}).sort();

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
    ...(nativeAddons(config).length === 0 ? {} : { native: nativeAddons(config) }),
  }).pipe(
    Effect.mapError(
      (error) => new InvalidConfig({ path: "macrograph.json", reason: error.message }),
    ),
  );

export * as PackageConfig from "./PackageConfig.ts";
