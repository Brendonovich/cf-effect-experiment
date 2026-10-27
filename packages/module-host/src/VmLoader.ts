import type { ModuleId } from "@macrograph/module/ModuleId";

import { Manifest } from "@macrograph/module/Manifest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { Effect, Option, Schema } from "effect";
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { compileFunction } from "node:vm";

import { SharedLibraryTable } from "./SharedLibraryTable.ts";

export class EvaluateError extends Schema.TaggedError<EvaluateError>()("EvaluateError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export class RequireError extends Error {
  override readonly name = "RequireError";
}

/**
 * The `require` given to a server entry. It resolves shared libraries to the host's own
 * instances and `node:*` built-ins the manifest declares; everything else throws.
 */
export const makeRequire = (
  id: ModuleId.Id,
  manifest: Manifest.Model,
): ModulePackage.ServerEntryRequire => {
  return (specifier) => {
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
      `${id}: cannot require "${specifier}". Server entries may only require shared libraries (${SharedLibraries.server.join(", ")}) and declared node: built-ins; bundle everything else`,
    );
  };
};

/**
 * Evaluates server entry source in the main context and returns its default export. The code is
 * never registered with Node's module caches, so once nothing references its exports it can be
 * garbage-collected.
 */
export const evaluateSource = (
  id: ModuleId.Id,
  manifest: Manifest.Model,
  code: string,
  filename: string,
): unknown => {
  const run = compileFunction(code, [...ModulePackage.ServerEntryParameters], { filename });
  const module: ModulePackage.ServerEntryModule = { exports: {} };
  run(makeRequire(id, manifest), module, module.exports);
  return ModulePackage.serverEntryDefault(module);
};

const message = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Reads the manifest's server entry from a module folder and evaluates it. */
export const evaluate = (input: {
  readonly id: ModuleId.Id;
  readonly root: string;
  readonly manifest: Manifest.Model;
}): Effect.Effect<unknown, EvaluateError> =>
  Effect.try({
    try: () => {
      const filename = join(input.root, input.manifest.server);
      const code = readFileSync(filename, "utf8");
      return evaluateSource(input.id, input.manifest, code, filename);
    },
    catch: (error) => new EvaluateError({ id: input.id, message: message(error) }),
  });

export * as VmLoader from "./VmLoader.ts";
