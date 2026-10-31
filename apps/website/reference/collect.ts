import type * as t from "@macrograph/module/DataType";

import { Package } from "@macrograph/core";
import { ModuleId } from "@macrograph/module/ModuleId";
import * as Registration from "@macrograph/module/Registration";
import { Effect, Schema } from "effect";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/** A module's package as JSON, with only the schemas users can add to graphs. */
export type EncodedPackage = typeof Package.Model.Encoded;

export interface CollectedModule {
  /** The id the module is published under, e.g. `macrograph.app/macrograph/twitch`. */
  readonly id: ModuleId.Id;
  /** The npm package that provides the module. */
  readonly source: string;
  readonly modulePath: string;
  readonly package: EncodedPackage;
}

interface ModuleDefinition {
  readonly name?: string;
  readonly description?: string;
  readonly types?: t.Definitions;
  readonly effect: Parameters<typeof Registration.collectModule>[0];
  readonly engine?: { readonly Resource?: ReadonlyArray<Package.ResourceInfo> };
}

const isModule = (value: unknown): value is ModuleDefinition =>
  typeof value === "object" &&
  value !== null &&
  "effect" in value &&
  typeof value.effect === "function";

/** The parts of a module's `package.json` that say what it is and where it's published. */
const ModulePackageJson = Schema.Struct({
  name: Schema.String,
  exports: Schema.Struct({ ".": Schema.String }),
  macrograph: Schema.Struct({ publisher: ModuleId.Publisher, name: ModuleId.Name }),
});

const modulesDirectory = resolve(import.meta.dirname, "../../../packages/modules");

/** Workspace modules with a `macrograph` manifest, under the official registry ids they publish to. */
const discover = () =>
  readdirSync(modulesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const directory = resolve(modulesDirectory, entry.name);
      const packageJson = resolve(directory, "package.json");
      if (!existsSync(packageJson)) return [];
      const manifest = Schema.decodeUnknownOption(ModulePackageJson)(
        JSON.parse(readFileSync(packageJson, "utf8")),
      );
      if (manifest._tag === "None") return [];
      return [
        {
          id: ModuleId.make({
            namespace: ModuleId.OfficialNamespace,
            publisher: manifest.value.macrograph.publisher,
            name: manifest.value.macrograph.name,
          }),
          source: manifest.value.name,
          modulePath: resolve(directory, manifest.value.exports["."]),
        },
      ];
    });

const encode = Schema.encodeSync(Package.Model);

/**
 * Every workspace module's package, registered without running engines. Vite's module runner
 * imports this at build time, since modules ship TypeScript source; it closes once the import
 * settles, so the modules load at the top level.
 */
export const modules: ReadonlyArray<CollectedModule> = await Promise.all(
  discover().map(async ({ id, source, modulePath }) => {
    const imported: unknown = await import(/* @vite-ignore */ modulePath);
    const module =
      typeof imported === "object" && imported !== null && "default" in imported
        ? imported.default
        : undefined;
    if (!isModule(module)) throw new Error(`${source} does not default-export a module`);
    const collected = await Effect.runPromise(
      Registration.collectModule(module.effect, {
        moduleId: id,
        ...(module.types === undefined ? {} : { types: module.types }),
      }),
    );
    const pkg = Package.fromModule(
      {
        id,
        ...(module.name === undefined ? {} : { name: module.name }),
        ...(module.description === undefined ? {} : { description: module.description }),
      },
      module.engine?.Resource ?? [],
      collected,
      collected.types,
    );
    return {
      id,
      source,
      modulePath,
      package: encode({ ...pkg, schemas: pkg.schemas.filter((schema) => !schema.internal) }),
    };
  }),
);
