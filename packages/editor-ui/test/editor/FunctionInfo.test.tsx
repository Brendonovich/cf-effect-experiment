// @vitest-environment jsdom
import { CanvasId, IoId, type Function as GraphFunction } from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import { FunctionInfo } from "../../src/editor/inspector/FunctionInfo";

const graph = {
  id: CanvasId.make("function"),
  name: "Function",
  nodes: {},
  connections: [],
};

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

it("uses click-to-edit field names and a hoverable trash action", async () => {
  const field: GraphFunction.Field = {
    id: IoId.make("name"),
    name: "Name",
    type: DataType.String,
  };
  const fn: GraphFunction.Model = {
    canvas: graph,
    arguments: [field],
    returns: [],
    inputPosition: { x: 0, y: 0 },
    outputPosition: { x: 100, y: 0 },
  };
  const onUpdateField = vi.fn();
  const onReorderField = vi.fn();
  const onDeleteField = vi.fn();
  const addedField: GraphFunction.Field = {
    id: IoId.make("added"),
    name: "Input 2",
    type: DataType.String,
  };

  dispose = render(() => {
    const [model, setModel] = createSignal(fn);
    return (
      <FunctionInfo
        graph={graph}
        fn={model()}
        definitions={{}}
        canEdit
        editingName={false}
        onEditingNameChange={() => {}}
        onRename={() => {}}
        onAddField={async () => {
          setModel((current) => ({
            ...current,
            arguments: [...current.arguments, addedField],
          }));
          return addedField.id;
        }}
        onUpdateField={onUpdateField}
        onReorderField={onReorderField}
        onDeleteField={onDeleteField}
      />
    );
  }, document.body);
  flush();

  const nameButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === field.name,
  );
  expect(nameButton).toBeDefined();
  expect(document.querySelector('[data-component="data-type-picker"]')).not.toBeNull();

  nameButton!.click();
  flush();
  await Promise.resolve();
  const nameInput = document.querySelector<HTMLInputElement>('[aria-label="input field name"]')!;
  nameInput.value = "Renamed";
  nameInput.blur();
  flush();
  expect(onUpdateField).toHaveBeenCalledWith("input", { ...field, name: "Renamed" });

  document.querySelector<HTMLButtonElement>('[aria-label="Remove Name"]')!.click();
  expect(onDeleteField).toHaveBeenCalledWith("input", field.id);

  document.querySelector<HTMLButtonElement>('[aria-label="Add argument"]')!.click();
  await Promise.resolve();
  flush();
  expect(document.querySelector<HTMLInputElement>('[aria-label="input field name"]')?.value).toBe(
    addedField.name,
  );

  document
    .querySelector('[aria-label="Drag Name to reorder"]')!
    .dispatchEvent(new Event("dragstart", { bubbles: true }));
  flush();
  document
    .querySelector('[aria-label="Drag Input 2 to reorder"]')!
    .parentElement!.dispatchEvent(new Event("drop", { bubbles: true }));
  expect(onReorderField).toHaveBeenCalledWith("input", field.id, addedField.id);
});
