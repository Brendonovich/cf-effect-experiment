import type { ResourceConstant } from "@macrograph/core";

import { createMemo, createSignal, mapArray } from "solid-js";

import type { createEditorWorkspace } from "../workspace/createEditorWorkspace";

import { type createEditorStore, resourceValuesKey } from "../store";
import { rankedSearch } from "./search";

export function createEditorCatalog(
  editor: ReturnType<typeof createEditorStore>,
  graphs: ReturnType<typeof createEditorWorkspace>["graphs"],
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
  const packageDocuments = mapArray(
    () => store.packages,
    (pkg) =>
      createMemo(() => ({
        item: pkg,
        key: pkg.id,
        fields: [
          pkg.name,
          pkg.id,
          ...pkg.schemas.flatMap((schema) => [schema.name, schema.id, schema.description]),
        ],
      })),
  );
  const filteredPackages = createMemo(() => {
    const query = navSearch();
    if (query.trim() === "") return store.packages;
    return rankedSearch(
      query,
      packageDocuments().map((document) => document()),
    );
  });
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
    filteredPackages,
    resourceDefinition,
    valuesFor,
  };
}
