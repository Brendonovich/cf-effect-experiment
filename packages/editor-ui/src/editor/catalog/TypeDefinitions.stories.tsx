import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { TypeDefinition, type Project } from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { createMemo, createSignal } from "solid-js";

import { TypeDefinitions } from "./TypeDefinitions";

const meta: Meta<typeof TypeDefinitions> = {
  title: "Editor/Navigation/TypeDefinitions",
  component: TypeDefinitions,
  args: {
    project: { types: {}, graphs: {} },
    canEdit: true,
  },
  render: (args) => {
    const [saved, setSaved] = createSignal<Pick<Project.Model, "types" | "graphs"> | null>(null);
    const project = createMemo(() => saved() ?? args.project ?? { types: {}, graphs: {} });
    const pending = new Map<string, TypeDefinition.Change>();
    return (
      <>
        <TypeDefinitions
          {...args}
          project={project()}
          onPreview={async (change) => {
            if (args.onPreview) await args.onPreview(change);
            const before = project().types;
            const errors = TypeDefinition.validateChange(before, change);
            if (errors.length > 0) throw new Error(errors.map((error) => error.reason).join("; "));
            const id = change._tag === "Upsert" ? change.definition.id : change.id;
            const after =
              change._tag === "Upsert"
                ? { ...before, [id]: change.definition }
                : Object.fromEntries(Object.entries(before).filter(([key]) => key !== id));
            const token = crypto.randomUUID();
            pending.set(token, change);
            return {
              token,
              change,
              affectedTypes: TypeDefinition.affectedTypes(id, before, after).filter(
                (affected) => affected !== id,
              ),
              nodes: [],
            };
          }}
          onConfirm={async (token) => {
            if (args.onConfirm) await args.onConfirm(token);
            const change = pending.get(token);
            if (!change) throw new Error("Unknown preview token");
            const current = project();
            setSaved({
              ...current,
              types:
                change._tag === "Upsert"
                  ? { ...current.types, [change.definition.id]: change.definition }
                  : Object.fromEntries(
                      Object.entries(current.types).filter(([id]) => id !== change.id),
                    ),
            });
            pending.clear();
          }}
        />
        <output hidden data-saved-types>
          {JSON.stringify(project().types)}
        </output>
      </>
    );
  },
};

export default meta;
type Story = StoryObj<typeof TypeDefinitions>;

export const CreateFieldTypes: Story = {
  play: async ({ canvasElement }) => {
    const frame = () => new Promise(requestAnimationFrame);
    const click = (selector: string) => {
      const button = canvasElement.querySelector<HTMLButtonElement>(selector);
      if (!button || button.disabled) throw new Error(`Expected enabled button: ${selector}`);
      button.click();
    };
    const button = (name: string) => {
      const element = Array.from(canvasElement.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === name,
      );
      if (!element || element.disabled) throw new Error(`Expected enabled button: ${name}`);
      element.click();
    };
    const input = (label: string) => {
      const element = canvasElement.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
      if (!element || element.disabled) throw new Error(`Expected enabled input: ${label}`);
      return element;
    };
    const saved = (): DataType.Definitions =>
      JSON.parse(canvasElement.querySelector("[data-saved-types]")?.textContent ?? "{}");
    for (const kind of ["struct", "enum"]) {
      if (kind === "enum") {
        button("Enums");
        await frame();
      }
      click(`[aria-label="New ${kind}"]`);
      await frame();
      const defaultName = kind === "struct" ? "New Struct" : "New Enum";
      const definition = Object.values(saved()).find((item) => item.name === defaultName);
      if (!definition || input("Type name").value !== defaultName)
        throw new Error(`Expected ${kind} to be saved and selected immediately`);
      if (definition._tag === "Struct" && definition.fields.length !== 0)
        throw new Error("Expected an empty struct to be saved");
      if (
        definition._tag === "Enum" &&
        (definition.variants.length !== 1 ||
          definition.variants[0]?.name !== "Variant" ||
          definition.variants[0].fields.length !== 0)
      )
        throw new Error("Expected one empty default Variant");
      if (canvasElement.querySelector('[role="dialog"]'))
        throw new Error("Expected creation without confirmation");

      const name = `${kind} renamed`;
      input("Type name").value = name;
      input("Type name").dispatchEvent(new Event("input", { bubbles: true }));
      await frame();
      if (saved()[definition.id]?.name !== defaultName)
        throw new Error("Expected input to buffer the name without saving");
      input("Type name").dispatchEvent(new FocusEvent("blur"));
      await frame();
      if (saved()[definition.id]?.name !== name)
        throw new Error("Expected name change to auto-save");

      button("Add field");
      await frame();
      if (input("Field 1 name").value !== "field")
        throw new Error("Expected the default field name");
      click('[data-type-depth="0"]');
      await frame();
      await frame();
      const option = Array.from(
        canvasElement.querySelectorAll<HTMLButtonElement>('[role="option"]'),
      ).find((button) => button.textContent === "Int");
      if (!option) throw new Error(`Expected type picker to open in the ${kind} editor`);
      option.click();
      await frame();
      if (canvasElement.querySelector('[data-type-depth="0"]')?.textContent !== "Int")
        throw new Error(`Expected field type to update in the ${kind} editor`);

      input("Field 1 name").value = "value";
      input("Field 1 name").dispatchEvent(new Event("input", { bubbles: true }));
      input("Field 1 name").dispatchEvent(new FocusEvent("blur"));
      await frame();
      if (kind === "enum") {
        input("Variant 1 name").value = "Success";
        input("Variant 1 name").dispatchEvent(new Event("input", { bubbles: true }));
        input("Variant 1 name").dispatchEvent(new FocusEvent("blur"));
        await frame();
      }
      button(kind === "struct" ? "Enums" : "Structs");
      await frame();
      button(kind === "struct" ? "Structs" : "Enums");
      await frame();
      button(name);
      await frame();
      if (
        input("Type name").value !== name ||
        input("Field 1 name").value !== "value" ||
        canvasElement.querySelector('[data-type-depth="0"]')?.textContent !== "Int" ||
        (kind === "enum" && input("Variant 1 name").value !== "Success")
      )
        throw new Error(`Expected ${kind} edits to persist after reselecting`);
    }
  },
};

export const ImpactfulChanges: Story = {
  args: {
    project: {
      graphs: {},
      types: {
        person: {
          _tag: "Struct",
          id: DataType.DefinitionId.make("person"),
          name: "Person",
          fields: [],
        },
        team: {
          _tag: "Struct",
          id: DataType.DefinitionId.make("team"),
          name: "Team",
          fields: [{ name: "person", type: DataType.Custom(DataType.DefinitionId.make("person")) }],
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const frame = () => new Promise(requestAnimationFrame);
    const click = (name: string) => {
      const button = Array.from(canvasElement.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name,
      );
      if (!button || button.disabled) throw new Error(`Expected enabled button: ${name}`);
      button.click();
    };
    const saved = (): DataType.Definitions =>
      JSON.parse(canvasElement.querySelector("[data-saved-types]")?.textContent ?? "{}");
    click("Person");
    await frame();
    click("Add field");
    await frame();
    const after = saved().person;
    if (after?._tag !== "Struct" || after.fields.length !== 1)
      throw new Error("Expected changes affecting dependent types to auto-save");
    const name = canvasElement.querySelector<HTMLInputElement>('[aria-label="Type name"]');
    if (!name || name.disabled) throw new Error("Expected the editor to remain editable");
    name.value = "Profile";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
    if (saved().person?.name !== "Person")
      throw new Error("Expected the name edit to remain buffered until blur");
    name.dispatchEvent(new FocusEvent("blur"));
    await frame();
    if (saved().person?.name !== "Profile")
      throw new Error("Expected changes affecting dependent types to save on blur");
    if (canvasElement.querySelector('[role="dialog"]'))
      throw new Error("Expected impactful changes without confirmation");
    click("Team");
    await frame();
    click("Delete type Team");
    await frame();
    if (saved().team) throw new Error("Expected deletion to persist immediately");
    if (canvasElement.querySelector('[role="dialog"]'))
      throw new Error("Expected deletion without confirmation");
  },
};

export const FailedSave: Story = {
  args: {
    onConfirm: async () => {
      throw new Error("Save failed");
    },
  },
  play: async ({ canvasElement }) => {
    const create = canvasElement.querySelector<HTMLButtonElement>('[aria-label="New struct"]');
    if (!create) throw new Error("Expected create button");
    create.click();
    await new Promise(requestAnimationFrame);
    const retry = Array.from(canvasElement.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    if (!canvasElement.querySelector('[role="alert"]') || !retry || retry.disabled)
      throw new Error("Failed creation must show an actionable error");
    if (canvasElement.querySelector('[aria-label="Type name"]'))
      throw new Error("Failed creation must not select an unsaved type");
    if (canvasElement.querySelector("[data-saved-types]")?.textContent !== "{}")
      throw new Error("Failed creation must not persist a type");
  },
};
