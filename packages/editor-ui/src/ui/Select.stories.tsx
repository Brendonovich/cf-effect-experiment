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
