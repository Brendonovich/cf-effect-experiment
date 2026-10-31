import { Package } from "@macrograph/core";
import { ModuleId } from "@macrograph/module";
import * as Registration from "@macrograph/module/Registration";
import { discoverWorkspaceModules } from "@macrograph/module/vite";
import { Effect, Schema } from "effect";
import { readFileSync } from "node:fs";

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

interface ModuleDefinition extends Package.ModuleInfo {
  readonly effect: Parameters<typeof Registration.collectModule>[0];
  readonly engine?: { readonly Resource?: ReadonlyArray<Package.ResourceInfo> };
}

const isModule = (value: unknown): value is ModuleDefinition =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "effect" in value &&
  typeof value.effect === "function";

const Manifest = Schema.Struct({
  macrograph: Schema.optional(
    Schema.Struct({
      publisher: Schema.optional(ModuleId.Publisher),
      name: Schema.optional(ModuleId.Name),
    }),
  ),
});

/**
 * Modules are published to the official registry under their manifest's publisher and name.
 * Built-ins without one are published by `macrograph` under their module id, matching the links
 * the editor builds from loaded packages.
 */
const moduleId = (packageJson: string, module: ModuleDefinition) => {
  const manifest = Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(packageJson, "utf8")),
  );
  return ModuleId.make({
    namespace: ModuleId.OfficialNamespace,
    publisher: manifest.macrograph?.publisher ?? "macrograph",
    name: manifest.macrograph?.name ?? module.id,
  });
};

const encode = Schema.encodeSync(Package.Model);

/**
 * Every workspace module's package, registered without running engines. Vite's module runner
 * imports this at build time, since modules ship TypeScript source; it closes once the import
 * settles, so the modules load at the top level.
 */
export const modules: ReadonlyArray<CollectedModule> = await Promise.all(
  discoverWorkspaceModules({
    modulePath: (manifest) => {
      const path = manifest.exports?.["."];
      return typeof path === "string" ? path : undefined;
    },
  }).map(async ({ source, modulePath, packageJson }) => {
    const imported: unknown = await import(/* @vite-ignore */ modulePath);
    const module =
      typeof imported === "object" && imported !== null && "default" in imported
        ? imported.default
        : undefined;
    if (!isModule(module)) throw new Error(`${source} does not default-export a module`);
    const collected = await Effect.runPromise(Registration.collectModule(module.effect));
    const pkg = Package.fromModule(
      module,
      module.engine?.Resource ?? [],
      collected,
      module.types ?? {},
    );
    return {
      id: moduleId(packageJson, module),
      source,
      modulePath,
      package: encode({ ...pkg, schemas: pkg.schemas.filter((schema) => !schema.internal) }),
    };
  }),
);
