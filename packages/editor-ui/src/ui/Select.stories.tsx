import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { createSignal } from "solid-js";

import { noop } from "../editor/storybook-fixtures";
import { Select } from "./Select";

const options = [
  { id: "studio-pc", name: "Studio PC" },
  { id: "streaming-laptop", name: "Streaming Laptop" },
  { id: "capture-pc", name: "Capture PC" },
];

const meta: Meta<typeof Select> = {
  title: "Editor/Controls/Select",
  component: Select,
  args: {
    options,
    value: "studio-pc",
    valid: true,
    placeholder: "Select a connection",
    onChange: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ "min-height": "240px", width: "min(100%, 680px)" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]');
    if (!trigger) throw new Error("Expected select trigger");
    trigger.click();
    await new Promise(requestAnimationFrame);
    if (canvasElement.querySelector('input[type="search"]'))
      throw new Error("Short menus must not show search");
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  },
  render: (args) => {
    const [value, setValue] = createSignal("studio-pc");
    return (
      <div class="storybook-showcase storybook-showcase--properties">
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">Selected</span>
          <Select {...args} value={value()} onChange={setValue} />
        </section>
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">Placeholder</span>
          <Select {...args} value="" />
        </section>
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">Invalid selection</span>
          <Select {...args} value="removed-device" valid={false} />
        </section>
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">Unavailable</span>
          <Select {...args} options={[]} value="" unavailableLabel="No connections available" />
        </section>
      </div>
    );
  },
};

export const ScrollingOptions: Story = {
  args: {
    options: Array.from({ length: 50 }, (_, index) => ({
      id: index === 45 ? JSON.stringify("opencode/gpt-test-20260830") : `model-${index}`,
      name: `Model ${index + 1} (Org / Provider)`,
    })),
    value: "model-0",
    placeholder: "Select a model",
  },
  render: (args) => {
    const [value, setValue] = createSignal("model-0");
    return (
      <div data-scroll-container style={{ height: "280px", "overflow-y": "auto" }}>
        <div style={{ height: "600px", padding: "8px" }}>
          <Select {...args} value={value()} onChange={setValue} />
        </div>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]');
    const container = canvasElement.querySelector<HTMLDivElement>("[data-scroll-container]");
    if (!trigger || !container) throw new Error("Expected select and scroll container");
    trigger.click();
    await new Promise(requestAnimationFrame);
    const menu = canvasElement.querySelector<HTMLDivElement>('[role="listbox"]');
    if (!menu) throw new Error("Expected open select");
    menu.scrollTop = 120;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    if (menu.scrollTop === 0 || trigger.getAttribute("aria-expanded") !== "true")
      throw new Error("Scrolling options must keep the select open");
    container.scrollTop = 40;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    if (trigger.getAttribute("aria-expanded") !== "false")
      throw new Error("Scrolling the surrounding container must close the select");
  },
};

export const SearchableOptions: Story = {
  ...ScrollingOptions,
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]');
    if (!trigger) throw new Error("Expected select trigger");
    trigger.click();
    await new Promise(requestAnimationFrame);
    const search = canvasElement.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search || canvasElement.ownerDocument.activeElement !== search)
      throw new Error("Long menus must focus their search input");
    search.value = "  mODEL 46  ";
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    const options = canvasElement.querySelectorAll('[role="option"]');
    if (options.length !== 1 || options[0]?.textContent?.trim() !== "Model 46 (Org / Provider)")
      throw new Error("Search must filter labels case-insensitively");
    search.value = "  OPENCODE/GPT-TEST-20260830  ";
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    const idMatches = canvasElement.querySelectorAll('[role="option"]');
    if (idMatches.length !== 1 || idMatches[0]?.textContent?.trim() !== "Model 46 (Org / Provider)")
      throw new Error("Search must match hidden IDs without changing the displayed label");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (
      !trigger.textContent?.includes("Model 46") ||
      trigger.getAttribute("aria-expanded") !== "false"
    )
      throw new Error("Enter must select the filtered option");
    trigger.click();
    await new Promise(requestAnimationFrame);
    const reopened = canvasElement.querySelector<HTMLInputElement>('input[type="search"]');
    if (
      !reopened ||
      reopened.value !== "" ||
      canvasElement.querySelectorAll('[role="option"]').length !== 50
    )
      throw new Error("Reopening must reset search");
    reopened.value = "not a matching model";
    reopened.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (
      canvasElement.querySelectorAll('[role="option"]').length !== 0 ||
      !canvasElement.querySelector('[role="status"]')
    )
      throw new Error("Empty results must be explained");
    reopened.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (trigger.getAttribute("aria-expanded") !== "true")
      throw new Error("Enter with no matches must not select an unfiltered option");
    reopened.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (
      trigger.getAttribute("aria-expanded") !== "false" ||
      canvasElement.ownerDocument.activeElement !== trigger
    )
      throw new Error("Escape must close and restore trigger focus");
  },
};
