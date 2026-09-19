// @vitest-environment jsdom
import { PackageId, SchemaId, type Package } from "@macrograph/core";
import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vitest";

import { ModuleInfo } from "../../src/editor/inspector/ModuleInfo";

const module: Package.Model = {
  id: PackageId.make("example"),
  name: "Example",
  description: "An example automation module.",
  schemas: [
    {
      id: SchemaId.make("trigger"),
      name: "Trigger",
      type: "event",
      properties: [],
      dataInputs: [],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    },
    {
      id: SchemaId.make("hidden"),
      internal: true,
      name: "Hidden",
      type: "pure",
      properties: [],
      dataInputs: [],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    },
  ],
  resources: [{ id: "account", name: "Account" }],
};

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

it("shows module metadata and counts only public schemas", () => {
  dispose = render(() => <ModuleInfo module={module} />, document.body);

  expect(document.body.textContent).toContain("Module");
  expect(document.body.textContent).not.toContain("Module Info");
  expect(document.body.textContent).toContain("An example automation module.");
  expect(document.body.textContent).toContain("Example");
  expect(document.body.textContent).toContain("example");
  expect(document.querySelector('[aria-label="Schema breakdown"]')?.textContent).toContain(
    "event1",
  );
  expect(document.body.textContent).not.toContain("pure");
});
