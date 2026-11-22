import type { HostService } from "@macrograph/module/HostService";

import { Manifest } from "@macrograph/module/Manifest";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Layer, Option } from "effect";

import { ModuleCopies } from "./ModuleCopies.ts";
import { ModuleRegistryCore } from "./ModuleRegistryCore.ts";
import { ModuleState } from "./ModuleState.ts";

/**
 * A 64-bit FNV-1a hash as hex. Static modules have no files to hash; this only has to change when
 * the id or version does.
 */
export const hashString = (value: string) => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
};

/**
 * A built-in bundled into the host, described by the same fields as its `package.json`
 * `macrograph` field. `version` defaults to `0.1.0`, the version every built-in ships as.
 */
export interface BuiltinOptions {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly version?: string;
  readonly requires?: ReadonlyArray<HostService.Id>;
  /** The server entry's default export, or whatever the host's mounter expects. */
  readonly deployment: unknown;
}

/** A static module for a built-in under `macrograph.app/macrograph/<name>`. */
export const builtin = (options: BuiltinOptions): ModuleCopies.StaticModule => ({
  manifest: {
    manifest: Manifest.FormatVersion,
    publisher: "macrograph",
    name: options.name,
    version: options.version ?? "0.1.0",
    api: Manifest.ApiVersion,
    displayName: options.displayName,
    ...(options.description === undefined ? {} : { description: options.description }),
    server: "server.cjs",
    ...(options.requires === undefined || options.requires.length === 0
      ? {}
      : { requires: options.requires }),
  },
  deployment: options.deployment,
});

/** The id a static module loads under. */
export const id = (module: ModuleCopies.StaticModule): ModuleId.Id =>
  Manifest.moduleId(module.manifest, module.namespace ?? ModuleId.OfficialNamespace);

/** A platform with only imported modules: no folders, links, watcher or file state. */
export const platform = (
  modules: ReadonlyArray<ModuleCopies.StaticModule>,
): Effect.Effect<ModuleRegistryCore.Platform> =>
  Effect.map(ModuleState.memory(), (state) => {
    const groups = ModuleCopies.group(modules.map(ModuleCopies.staticCopy));
    return {
      state,
      scan: () => Effect.succeed(groups),
      contentHash: (copy) =>
        Effect.succeed(
          Option.getOrElse(
            Option.flatMap(copy.static, (value) => value.contentHash),
            () => hashString(`${copy.id}@${copy.manifest.version}`),
          ),
        ),
      evaluate: (copy) =>
        Effect.fail({ message: `${copy.id} has no imported server entry on this host` }),
      hashFolder: () => Effect.succeedNone,
      isWithin: () => false,
      resolveFile: () => Option.none(),
    };
  });

export interface Options extends ModuleRegistryCore.Options {
  readonly modules: ReadonlyArray<ModuleCopies.StaticModule>;
}

/**
 * A module registry for hosts that bundle their modules (cloud, playground). Needs a
 * `Mounter.Service` and `ModuleTrust.Service` (usually `ModuleTrust.none`).
 */
export const layer = (options: Options) =>
  Layer.effect(ModuleRegistryCore.Service)(
    Effect.flatMap(platform(options.modules), (value) => ModuleRegistryCore.make(options, value)),
  );

export * as StaticRegistry from "./StaticRegistry.ts";
