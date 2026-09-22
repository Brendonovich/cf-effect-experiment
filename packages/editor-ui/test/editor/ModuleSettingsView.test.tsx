// @vitest-environment jsdom
import {
  BuiltinAuthoring,
  CanvasId,
  Clipboard,
  IoId,
  PackageId,
  SchemaId,
  type Function as GraphFunction,
  type Package,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { render } from "@solidjs/web";
import { useMutation } from "@tanstack/solid-query";
import { Effect, Result } from "effect";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import { ModuleSettingsView } from "../../src/editor/modules/ModuleSettingsView";

const pkg: Package.Model = {
  id: PackageId.make("example"),
  name: "Example",
  resources: [{ id: "account", name: "Account" }],
  schemas: [
    {
      id: SchemaId.make("send-message"),
      name: "Send message",
      description: "Sends a message to the configured destination.",
      type: "exec",
      properties: [
        {
          id: "count",
          name: "Count",
          type: DataType.Int,
          optional: false,
          defaultValue: 1,
        },
        { id: "function", name: "Function", function: true, optional: true },
      ],
      dataInputs: [{ id: IoId.make("message"), name: "Message", type: DataType.Wildcard("Value") }],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    },
    {
      id: SchemaId.make("internal-helper"),
      name: "Internal helper",
      internal: true,
      type: "pure",
      properties: [],
      dataInputs: [],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    },
  ],
};

const functions: ReadonlyArray<GraphFunction.Model> = [
  {
    canvas: { id: CanvasId.make("notify"), name: "Notify", nodes: {}, connections: [] },
    arguments: [],
    returns: [{ id: IoId.make("result"), name: "Result", type: DataType.String }],
    inputPosition: { x: 0, y: 0 },
    outputPosition: { x: 0, y: 0 },
  },
];

const authoring = BuiltinAuthoring.registry.with({
  model: pkg,
  schemas: {
    "send-message": {
      generateIO: ({ declared, properties }) =>
        Result.succeed({
          ...declared,
          dataInputs: [
            ...declared.dataInputs,
            ...Array.from(
              { length: typeof properties.count === "number" ? properties.count : 0 },
              (_, index) => ({
                id: IoId.make(`item-${index + 1}`),
                name: `Item ${index + 1}`,
                type: DataType.String,
              }),
            ),
          ],
        }),
    },
  },
});

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

it("provides a query client to engine settings and runs their mutations", async () => {
  const onChanged = vi.fn(() => Promise.resolve());
  const Settings = () => {
    const mutation = useMutation(() => ({
      networkMode: "always" as const,
      mutationFn: onChanged,
    }));
    return (
      <button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isSuccess ? "Saved" : "Save settings"}
      </button>
    );
  };

  dispose = render(
    () => (
      <ModuleSettingsView
        package={pkg}
        settings={{ load: () => Effect.void, render: () => <Settings /> }}
        view={{ selectedView: "engine", selectedReferenceKey: null }}
        onViewChange={() => {}}
        data={{ endpoints: [], capabilities: new Set() }}
        state={() => undefined}
        onChanged={onChanged}
      />
    ),
    document.body,
  );
  flush();
  const save = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Save settings",
  )!;
  save.click();
  await vi.waitFor(() => {
    flush();
    expect(save.textContent).toBe("Saved");
  });
  expect(onChanged).toHaveBeenCalledOnce();
});

it("disables unavailable engine settings and selects the exposed node reference", () => {
  const [view, setView] = createSignal({
    selectedView: "engine" as const,
    selectedReferenceKey: null,
  });
  dispose = render(
    () => (
      <ModuleSettingsView
        package={pkg}
        authoring={authoring}
        definitions={{
          person: {
            _tag: "Struct",
            id: DataType.DefinitionId.make("person"),
            name: "Person",
            fields: [],
          },
        }}
        functions={functions}
        view={view()}
        onViewChange={setView}
        data={{ endpoints: [], capabilities: new Set() }}
        state={() => undefined}
        onChanged={() => Promise.resolve()}
      />
    ),
    document.body,
  );
  flush();

  const engine = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === "Engine",
  );

  const reference = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === "Reference",
  );

  expect(engine!.disabled).toBe(true);
  expect(engine!.getAttribute("aria-selected")).toBe("false");
  expect(reference!.getAttribute("aria-selected")).toBe("true");
  expect(document.body.textContent).toContain("Send message");
  expect(document.body.textContent).toContain("Sends a message to the configured destination.");
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search reference"]')!;
  expect(search).not.toBeNull();
  expect(document.body.textContent).not.toContain("Internal helper");
  expect(document.body.textContent).not.toContain(
    "This module has no configurable editor settings.",
  );
  expect(
    [...document.querySelectorAll("h4")].some((heading) => heading.textContent === "Exec Nodes"),
  ).toBe(true);

  search.value = "account";
  search.dispatchEvent(new InputEvent("input", { bubbles: true }));
  flush();
  expect(document.querySelector("aside")?.textContent).not.toContain("Send message");
  expect(document.querySelector("aside")?.textContent).toContain("Account");
  search.value = "";
  search.dispatchEvent(new InputEvent("input", { bubbles: true }));
  flush();

  const wildcard = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Value wildcard type, outer: String"]',
  )!;
  expect(document.body.textContent).toContain("Wildcards");
  expect(document.body.textContent).toContain("Value");
  wildcard.click();
  flush();
  const person = [...document.querySelectorAll<HTMLButtonElement>('button[role="option"]')].find(
    (button) => button.textContent === "Person",
  )!;
  person.click();
  flush();
  expect(
    document.querySelector<HTMLButtonElement>(
      'button[aria-label="Value wildcard type, outer: Person"]',
    ),
  ).not.toBeNull();
  expect(document.querySelector('[data-io-row="input"] span')?.getAttribute("title")).toBe(
    "Person",
  );

  expect(document.querySelectorAll('[data-io-id^="item-"]').length).toBe(1);
  const count = document.querySelector<HTMLInputElement>('input[type="number"]')!;
  count.value = "2";
  count.dispatchEvent(new InputEvent("input", { bubbles: true }));
  flush();
  count.dispatchEvent(new Event("change", { bubbles: true }));
  flush();
  expect(document.querySelectorAll('[data-io-id^="item-"]').length).toBe(2);

  const functionPicker = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Select function",
  )!;
  functionPicker.click();
  flush();
  const notify = [...document.querySelectorAll<HTMLButtonElement>('button[role="option"]')].find(
    (button) => button.textContent === "Notify",
  )!;
  notify.click();
  flush();
  expect(functionPicker.textContent).toBe("Notify");
  expect(
    [...document.querySelectorAll('[data-io-row="output"]')].some(
      (row) => row.textContent === "Result",
    ),
  ).toBe(true);

  document
    .querySelector<HTMLElement>('[data-node-header="module-reference-preview"]')!
    .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  flush();
  const setData = vi.fn();
  const copy = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(copy, "clipboardData", { value: { setData } });
  document.activeElement!.dispatchEvent(copy);
  expect(copy.defaultPrevented).toBe(true);
  expect(setData).toHaveBeenCalledOnce();
  const fragment = Effect.runSync(Clipboard.decode(setData.mock.calls[0]![1]));
  expect(fragment.nodes[0]?.properties).toEqual({ count: 2, function: "notify" });

  const account = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Account",
  )!;
  account.click();
  flush();
  expect(view().selectedReferenceKey).toBe("resource:account");
  expect(account.getAttribute("aria-pressed")).toBe("true");
});

it("copies resource-node references in the strict clipboard format accepted by paste", () => {
  const lightPackage: Package.Model = {
    id: PackageId.make("lifx"),
    name: "LIFX",
    resources: [{ id: "LIFXLight", name: "Light" }],
    schemas: [
      {
        id: SchemaId.make("SetLightPower"),
        internal: false,
        name: "Set Light Power",
        type: "exec",
        properties: [{ id: "light", name: "Light", resource: "LIFXLight", optional: false }],
        dataInputs: [
          { id: IoId.make("power"), name: "On", type: DataType.Bool, defaultValue: true },
          { id: IoId.make("duration"), name: "Duration (ms)", type: DataType.Int, defaultValue: 0 },
        ],
        dataOutputs: [],
        executionInputs: [{ id: IoId.make("exec") }],
        executionOutputs: [{ id: IoId.make("exec") }],
      },
    ],
  };
  dispose = render(
    () => (
      <ModuleSettingsView
        package={lightPackage}
        view={{ selectedView: "reference", selectedReferenceKey: "node:SetLightPower" }}
        onViewChange={() => {}}
        data={{ endpoints: [], capabilities: new Set() }}
        state={() => undefined}
        onChanged={() => Promise.resolve()}
      />
    ),
    document.body,
  );
  flush();
  document
    .querySelector<HTMLElement>('[data-node-header="module-reference-preview"]')!
    .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  flush();
  const setData = vi.fn();
  const copy = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(copy, "clipboardData", { value: { setData } });
  document.activeElement!.dispatchEvent(copy);

  expect(copy.defaultPrevented).toBe(true);
  expect(setData).toHaveBeenCalledOnce();
  const fragment = Effect.runSync(Clipboard.decode(setData.mock.calls[0]![1]));
  const node = fragment.nodes[0]!;
  expect(node.schema).toEqual({ package: "lifx", schema: "SetLightPower" });
  expect(node.properties).toEqual({ light: null });
  expect(fragment.nodeIO?.[node.id]).toEqual({
    dataInputs: lightPackage.schemas[0]!.dataInputs,
    dataOutputs: [],
    executionInputs: [{ id: "exec" }],
    executionOutputs: [{ id: "exec" }],
  });
});
