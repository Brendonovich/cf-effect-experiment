import { PackageId, SchemaId, type Package } from "@macrograph/core";
import { createRoot, flush } from "solid-js";
import { expect, it } from "vitest";

import { createEditorCatalog } from "../../../src/editor/catalog/createEditorCatalog";
import { createEditorStore } from "../../../src/editor/store";

it("keeps module searches current when the query and catalog change", () => {
  const { dispose, pkg, editor, catalog } = createRoot((dispose) => {
    const pkg: Package.Model = {
      id: PackageId.make("utilities"),
      name: "Utilities",
      resources: [],
      schemas: [
        {
          id: SchemaId.make("concat"),
          name: "Concatenate text",
          description: "Join strings together",
          type: "pure",
          properties: [],
          dataInputs: [],
          dataOutputs: [],
          executionInputs: [],
          executionOutputs: [],
        },
      ],
    };
    const editor = createEditorStore();
    editor.setPackages([pkg]);
    const catalog = createEditorCatalog(editor, () => []);
    return { dispose, pkg, editor, catalog };
  });
  try {
    flush();
    expect(catalog.filteredPackages().map((item) => item.id)).toEqual([pkg.id]);

    catalog.setNavSearch("missing");
    flush();
    expect(catalog.filteredPackages()).toEqual([]);

    catalog.setNavSearch("concatenate");
    flush();
    expect(catalog.filteredPackages().map((item) => item.id)).toEqual([pkg.id]);

    catalog.setNavSearch("join");
    flush();
    expect(catalog.filteredPackages().map((item) => item.id)).toEqual([pkg.id]);

    editor.setPackages([{ ...pkg, schemas: [] }]);
    flush();
    expect(catalog.filteredPackages()).toEqual([]);
    editor.setPackages([pkg]);
    flush();
    expect(catalog.filteredPackages().map((item) => item.id)).toEqual([pkg.id]);

    catalog.setNavSearch("   ");
    flush();
    expect(catalog.filteredPackages().map((item) => item.id)).toEqual([pkg.id]);
  } finally {
    dispose();
  }
});
