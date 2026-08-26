import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { createSignal } from "solid-js";

import { noop } from "../storybook-fixtures";
import { PropertyControl } from "./PropertyControl";

const meta: Meta<typeof PropertyControl> = {
  title: "Editor/Inspector/PropertyControl",
  component: PropertyControl,
  args: {
    property: {
      id: "message",
      name: "Message",
      description: "The message sent to your Twitch channel.",
      type: { _tag: "String" },
      optional: false,
    },
    value: "Thanks for watching!",
    onSet: noop,
    onClear: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "min(100%, 680px)" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PropertyControl>;

export const Variants: Story = {
  render: (args) => {
    const [enabled, setEnabled] = createSignal(true);
    return (
      <div class="storybook-showcase storybook-showcase--properties">
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">String</span>
          <PropertyControl {...args} />
        </section>
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">Integer</span>
          <PropertyControl
            {...args}
            property={{
              id: "duration",
              name: "Transition duration",
              description: "Duration in milliseconds.",
              type: { _tag: "Int" },
              optional: true,
              defaultValue: 300,
            }}
            value={450}
          />
        </section>
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">Float</span>
          <PropertyControl
            {...args}
            property={{
              id: "volume",
              name: "Volume multiplier",
              type: { _tag: "Float" },
              optional: false,
            }}
            value={0.75}
          />
        </section>
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">Boolean</span>
          <PropertyControl
            {...args}
            property={{
              id: "case-sensitive",
              name: "Case sensitive",
              description: "Match uppercase and lowercase characters exactly.",
              type: { _tag: "Bool" },
              optional: false,
            }}
            value={enabled()}
            onSet={setEnabled}
          />
        </section>
      </div>
    );
  },
};
