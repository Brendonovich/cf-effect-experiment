import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";

import { Manifest } from "@macrograph/module/Manifest";
import { ModuleId } from "@macrograph/module/ModuleId";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Effect, Option, Result, Schema } from "effect";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { ContentHash } from "./ContentHash.ts";
import { ModuleCopies } from "./ModuleCopies.ts";
import { ModuleState } from "./ModuleState.ts";

/** Folders under `<dataDir>/modules/`. */
export interface Paths {
  readonly root: string;
  /** `installed/<namespace>/<publisher>/<name>/<version>/`, written by the installer. */
  readonly installed: string;
  /** `local/<publisher>/<name>/`, loaded as `local/<publisher>/<name>`. */
  readonly local: string;
  readonly state: string;
}

export const paths = (dataDir: string): Paths => {
  const root = join(resolve(dataDir), "modules");
  return {
    root,
    installed: join(root, "installed"),
    local: join(root, "local"),
    state: join(root, ModuleState.FileName),
  };
};

export type Copy = ModuleCopies.Copy;
export type InvalidCopy = ModuleCopies.InvalidCopy;
export type Group = ModuleCopies.Group;
export type StaticModule = ModuleCopies.StaticModule;

export interface Layout {
  /** Roots laid out as `<namespace>/<publisher>/<name>/<version>/`, e.g. `dist/modules`. */
  readonly shippedDirs: ReadonlyArray<string>;
  readonly paths: Option.Option<Paths>;
  readonly links: ReadonlyMap<ModuleId.Id, string>;
  readonly staticModules: ReadonlyArray<StaticModule>;
}

const decodeManifest = Schema.decodeUnknownResult(Schema.fromJsonString(Manifest.Model));

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reads and validates `macrograph.json` in a module folder. */
export const readManifest = (root: string): Result.Result<Manifest.Model, string> => {
  let text: string;
  try {
    text = readFileSync(join(root, ModulePackage.ManifestFile), "utf8");
  } catch (error) {
    return Result.fail(`Cannot read ${ModulePackage.ManifestFile}: ${errorMessage(error)}`);
  }
  return Result.mapError(
    decodeManifest(text),
    (error) => `Invalid ${ModulePackage.ManifestFile}: ${error.message}`,
  );
};

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const subdirectories = (path: string): ReadonlyArray<string> => {
  try {
    return readdirSync(path)
      .filter((name) => !name.startsWith(".") && isDirectory(join(path, name)))
      .sort();
  } catch {
    return [];
  }
};

const folderCopy = (
  id: ModuleId.Id,
  source: ModuleCatalog.SourceKind,
  root: string,
  check: (manifest: Manifest.Model) => Option.Option<string>,
): Copy | InvalidCopy =>
  Result.match(readManifest(root), {
    onFailure: (error): InvalidCopy => ({ id, source, root, error }),
    onSuccess: (manifest): Copy | InvalidCopy =>
      Option.match(check(manifest), {
        onSome: (error): InvalidCopy => ({ id, source, root, error }),
        onNone: (): Copy => ({
          id,
          source,
          root: Option.some(root),
          manifest,
          static: Option.none(),
        }),
      }),
  });

const identityMismatch = (manifest: Manifest.Model, id: ModuleId.Id): Option.Option<string> => {
  const parts = ModuleId.parts(id);
  return manifest.publisher === parts.publisher && manifest.name === parts.name
    ? Option.none()
    : Option.some(
        `Manifest declares ${manifest.publisher}/${manifest.name}, but the folder holds ${parts.publisher}/${parts.name}`,
      );
};

/** Scans a `<namespace>/<publisher>/<name>/<version>/` tree. */
const scanVersioned = (
  root: string,
  source: ModuleCatalog.SourceKind,
): ReadonlyArray<Copy | InvalidCopy> =>
  subdirectories(root).flatMap((namespace) => {
    if (!ModuleId.isRegistryNamespace(namespace)) return [];
    return subdirectories(join(root, namespace)).flatMap((publisher) =>
      subdirectories(join(root, namespace, publisher)).flatMap((name) => {
        const id = ModuleId.parse(`${namespace}/${publisher}/${name}`);
        if (Option.isNone(id)) return [];
        return subdirectories(join(root, namespace, publisher, name))
          .filter(Manifest.isSemver)
          .map((version) =>
            folderCopy(
              id.value,
              source,
              join(root, namespace, publisher, name, version),
              (manifest) =>
                Option.orElse(identityMismatch(manifest, id.value), () =>
                  manifest.version === version
                    ? Option.none()
                    : Option.some(
                        `Manifest declares version ${manifest.version}, but the folder is ${version}`,
                      ),
                ),
            ),
          );
      }),
    );
  });

const scanLocal = (root: string): ReadonlyArray<Copy | InvalidCopy> =>
  subdirectories(root).flatMap((publisher) =>
    subdirectories(join(root, publisher)).flatMap((name) =>
      Option.match(ModuleId.parse(`${ModuleId.LocalNamespace}/${publisher}/${name}`), {
        onNone: () => [],
        onSome: (id) => [
          folderCopy(id, "local", join(root, publisher, name), (manifest) =>
            identityMismatch(manifest, id),
          ),
        ],
      }),
    ),
  );

/** Checks that a folder can be linked under an id. */
export const validateLink = (id: ModuleId.Id, path: string): Result.Result<Copy, string> => {
  if (ModuleId.isLocal(id))
    return Result.fail("Local modules are loaded from the local folder and can't be linked");
  const root = resolve(path);
  if (!isDirectory(root)) return Result.fail(`${root} is not a folder`);
  const copy = folderCopy(id, "linked", root, (manifest) => identityMismatch(manifest, id));
  return "error" in copy ? Result.fail(copy.error) : Result.succeed(copy);
};

/** Reads every source and groups the copies found by module id. Never fails. */
export const scan = (layout: Layout): Effect.Effect<ReadonlyMap<ModuleId.Id, Group>> =>
  Effect.sync(() => {
    const found: Array<Copy | InvalidCopy> = [
      ...layout.staticModules.map(ModuleCopies.staticCopy),
      ...layout.shippedDirs.flatMap((dir) => scanVersioned(resolve(dir), "shipped")),
      ...Option.match(layout.paths, {
        onNone: () => [],
        onSome: (paths) => [
          ...scanVersioned(paths.installed, "installed"),
          ...scanLocal(paths.local),
        ],
      }),
      ...[...layout.links].map(([id, path]) =>
        Result.match(validateLink(id, path), {
          onSuccess: (copy): Copy | InvalidCopy => copy,
          onFailure: (error): InvalidCopy => ({ id, source: "linked", root: resolve(path), error }),
        }),
      ),
    ];
    return ModuleCopies.group(found);
  });

/** The content hash of a copy: its folder's hash, or the static module's declared hash. */
export const contentHash = (copy: Copy): Effect.Effect<string, ContentHash.ContentHashError> =>
  Option.match(
    Option.flatMap(copy.static, (value) => value.contentHash),
    {
      onSome: Effect.succeed,
      onNone: () =>
        Option.match(copy.root, {
          onSome: ContentHash.compute,
          onNone: () => Effect.succeed(ContentHash.ofString(`${copy.id}@${copy.manifest.version}`)),
        }),
    },
  );

export * as ModuleSources from "./ModuleSources.ts";
