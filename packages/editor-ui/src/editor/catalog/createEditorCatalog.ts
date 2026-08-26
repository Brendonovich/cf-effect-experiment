import type { ResourceConstant } from "@macrograph/core";

import { createSignal } from "solid-js";

import type { createEditorConnection } from "../session/createEditorConnection";
import type { createEditorWorkspace } from "../workspace/createEditorWorkspace";

import { rankedSearch } from "./search";
import { type createEditorStore, resourceValuesKey } from "../store";

export function createEditorCatalog(
  editor: ReturnType<typeof createEditorStore>,
  graphs: ReturnType<typeof createEditorWorkspace>["graphs"],
  pluginSettingsById: ReturnType<typeof createEditorConnection>["pluginSettingsById"],
) {
  const { store } = editor;
  const [navSearch, setNavSearch] = createSignal("");
  const filteredGraphs = () =>
    rankedSearch(
      navSearch(),
      graphs().map(([id, graph]) => ({
        item: [id, graph] as const,
        key: id,
        fields: [graph.name, id],
      })),
    );
  const filteredPackages = () =>
    rankedSearch(
      navSearch(),
      store.packages.map((pkg) => ({
        item: pkg,
        key: pkg.id,
        fields: [
          pkg.name,
          pkg.id,
          ...pkg.schemas.flatMap((schema) => [schema.name, schema.id, schema.description]),
        ],
      })),
    );
  const filteredPackagesWithSettings = () =>
    filteredPackages().filter((pkg) => pluginSettingsById().has(pkg.id));
  const filteredPackagesWithoutSettings = () =>
    filteredPackages().filter((pkg) => !pluginSettingsById().has(pkg.id));
  const resourceDefinition = (resource: ResourceConstant.ResourceRef) => {
    const pkg = store.packages.find((candidate) => candidate.id === resource.package);
    const definition = pkg?.resources.find((candidate) => candidate.id === resource.resource);
    return pkg && definition ? { pkg, definition } : undefined;
  };
  const valuesFor = (resource: ResourceConstant.ResourceRef) =>
    store.resourceValues[resourceValuesKey(resource.package, resource.resource)] ?? [];

  return {
    navSearch,
    setNavSearch,
    filteredGraphs,
    filteredPackagesWithSettings,
    filteredPackagesWithoutSettings,
    resourceDefinition,
    valuesFor,
  };
}
