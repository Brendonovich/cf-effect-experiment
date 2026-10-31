import type { Plugin } from "vite";

import * as ModuleId from "@macrograph/module/ModuleId";
import { resolve } from "node:path";
import { runnerImport } from "vite";

import type { CollectedModule } from "./collect";

const virtualId = "virtual:macrograph-reference";
const packagePrefix = `${virtualId}/package/`;
const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const watched = ["packages/modules", "packages/module/src", "packages/core/src"].map(
  (path) => `${resolve(workspaceRoot, path)}/`,
);

/**
 * Serves the node reference for every workspace module as `virtual:macrograph-reference`. Modules
 * are registered at build time, so pages ship their packages as JSON; a module's own code loads
 * only when a page needs to generate node IO for chosen properties.
 */
export const reference = (): Plugin => {
  let modules: Promise<ReadonlyArray<CollectedModule>> | undefined;
  const load = () =>
    (modules ??= runnerImport<typeof import("./collect")>(
      resolve(import.meta.dirname, "collect.ts"),
      { configFile: false, logLevel: "error", ssr: { noExternal: [/^@macrograph\//] } },
    ).then(({ module }) => module.modules));

  return {
    name: "macrograph-reference",
    resolveId(id) {
      return id === virtualId || id.startsWith(packagePrefix) ? `\0${id}` : undefined;
    },
    async load(id) {
      if (id === `\0${virtualId}`) {
        const entries = (await load())
          .filter(({ package: pkg }) => pkg.schemas.length > 0 || (pkg.resources?.length ?? 0) > 0)
          .toSorted((left, right) => left.package.name.localeCompare(right.package.name));
        const summaries = entries.map(({ id, source, package: pkg }) => ({
          id,
          ...ModuleId.parts(id),
          displayName: pkg.name,
          ...(pkg.description === undefined ? {} : { description: pkg.description }),
          source,
          nodes: pkg.schemas.length,
          resources: pkg.resources?.length ?? 0,
        }));
        const loaders = (path: (entry: CollectedModule) => string) =>
          entries
            .map(
              (entry) =>
                `${JSON.stringify(entry.id)}: () => import(${JSON.stringify(path(entry))})`,
            )
            .join(",\n  ");
        return [
          `export const packages = ${JSON.stringify(summaries)};`,
          `const packageLoaders = {\n  ${loaders((entry) => `${packagePrefix}${entry.id}`)}\n};`,
          `const moduleLoaders = {\n  ${loaders((entry) => entry.modulePath)}\n};`,
          `export const loadPackage = async (id) => {\n  const load = packageLoaders[id];\n  return load === undefined ? null : (await load()).default;\n};`,
          `export const loadModule = async (id) => {\n  const load = moduleLoaders[id];\n  return load === undefined ? null : (await load()).default;\n};`,
          "",
        ].join("\n");
      }
      if (id.startsWith(`\0${packagePrefix}`)) {
        const moduleId = id.slice(packagePrefix.length + 1);
        const entry = (await load()).find((candidate) => candidate.id === moduleId);
        if (entry === undefined) throw new Error(`Unknown reference package ${moduleId}`);
        return `export default ${JSON.stringify(entry.package)};\n`;
      }
      return undefined;
    },
    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (!watched.some((path) => file.startsWith(path))) return;
        modules = undefined;
        for (const environment of Object.values(server.environments)) {
          for (const module of environment.moduleGraph.idToModuleMap.values())
            if (module.id?.startsWith(`\0${virtualId}`))
              environment.moduleGraph.invalidateModule(module);
        }
      });
    },
  };
};
