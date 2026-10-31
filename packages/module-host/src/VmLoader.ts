import type { ModuleId } from "@macrograph/module/ModuleId";

import { Manifest } from "@macrograph/module/Manifest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { Effect, Option, Schema } from "effect";
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { compileFunction } from "node:vm";

import { NativeAddons } from "./NativeAddons.ts";
import { SharedLibraryTable } from "./SharedLibraryTable.ts";

export class EvaluateError extends Schema.TaggedError<EvaluateError>()("EvaluateError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export class RequireError extends Error {
  override readonly name = "RequireError";
}

export interface Input {
  readonly id: ModuleId.Id;
  /** The module's package folder. */
  readonly root: string;
  readonly manifest: Manifest.Model;
}

/**
 * The `require` given to a server entry. It resolves shared libraries to the host's own
 * instances, `node:*` built-ins the manifest declares, and declared native addons
 * (`macrograph:native/<name>`); everything else throws.
 */
export const makeRequire = (input: Input): ModulePackage.ServerEntryRequire => {
  const { id, manifest } = input;
  return (specifier) => {
    const native = ModulePackage.parseNativeSpecifier(specifier);
    if (native !== undefined) return NativeAddons.load(input, native);
    const shared = SharedLibraryTable.resolve(specifier);
    if (Option.isSome(shared)) return shared.value;
    if (SharedLibraries.isShared(specifier, "server"))
      throw new RequireError(
        `${id}: "${specifier}" is not exported by the host's shared libraries`,
      );
    if (isBuiltin(specifier)) {
      const prefixed = specifier.startsWith("node:") ? specifier : `node:${specifier}`;
      if (Manifest.allowsNodeBuiltin(manifest, prefixed)) {
        const builtin = process.getBuiltinModule(prefixed);
        if (builtin !== undefined) return builtin;
      }
      throw new RequireError(
        `${id}: "${specifier}" is a Node built-in the manifest doesn't declare; add "${prefixed.slice("node:".length)}" to its "node" list`,
      );
    }
    throw new RequireError(
      `${id}: cannot require "${specifier}". Server entries may only require shared libraries (${SharedLibraries.server.join(", ")}), declared node: built-ins and declared native addons; bundle everything else`,
    );
  };
};

/**
 * Evaluates server entry source in the main context and returns its default export. The code is
 * never registered with Node's module caches, so once nothing references its exports it can be
 * garbage-collected.
 */
export const evaluateSource = (input: Input, code: string, filename: string): unknown => {
  const run = compileFunction(code, [...ModulePackage.ServerEntryParameters], { filename });
  const module: ModulePackage.ServerEntryModule = { exports: {} };
  run(makeRequire(input), module, module.exports);
  return ModulePackage.serverEntryDefault(module);
};

const message = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Reads the manifest's server entry from a module folder and evaluates it. */
export const evaluate = (input: Input): Effect.Effect<unknown, EvaluateError> =>
  Effect.try({
    try: () => {
      const filename = join(input.root, input.manifest.server);
      const code = readFileSync(filename, "utf8");
      return evaluateSource(input, code, filename);
    },
    catch: (error) => new EvaluateError({ id: input.id, message: message(error) }),
  });

export * as VmLoader from "./VmLoader.ts";
