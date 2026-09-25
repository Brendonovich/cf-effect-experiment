// @vitest-environment jsdom
import { PackageId, SchemaId, type Package } from "@macrograph/core";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import { NodeCreationMenu } from "../../src/editor/graph/NodeCreationMenu";

const packages: ReadonlyArray<Package.Model> = ["Twitch", "Utilities", "OBS Studio"].map(
  (name) => ({
    id: PackageId.make(name.toLowerCase().replace(" ", "-")),
    name,
    schemas: [
      {
        id: SchemaId.make("schema"),
        name: "Schema",
        type: "pure",
        description: "",
        properties: [],
        dataInputs: [],
        dataOutputs: [],
        executionInputs: [],
        executionOutputs: [],
      },
    ],
    resources: [],
  }),
);

let dispose = () => {};

afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("sorts packages alphabetically", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  dispose = render(
    () => (
      <NodeCreationMenu
        packages={packages}
        screenPosition={{ x: 40, y: 40 }}
        onCreate={() => {}}
        onClose={() => {}}
      />
    ),
    document.body,
  );
  flush();

  expect(
    [...document.querySelectorAll("section > button")].map((button) =>
      button.textContent?.replace(/\d+$/, ""),
    ),
  ).toEqual(["OBS Studio", "Twitch", "Utilities"]);
});
