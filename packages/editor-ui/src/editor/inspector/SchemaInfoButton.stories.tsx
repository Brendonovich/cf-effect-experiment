import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { chatMessageSchema, containsSchema, switchSceneSchema } from "../storybook-fixtures";
import { SchemaInfoButton } from "./SchemaInfoButton";

const meta: Meta<typeof SchemaInfoButton> = {
  title: "Editor/Inspector/SchemaInfoButton",
  component: SchemaInfoButton,
  args: { schema: chatMessageSchema, packageName: "Twitch" },
  decorators: [
    (Story) => (
      <div style={{ "margin-left": "220px", width: "min(680px, calc(100vw - 252px))" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SchemaInfoButton>;

export const Variants: Story = {
  render: () => (
    <div class="storybook-showcase storybook-showcase--properties">
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Event</span>
        <div class="storybook-showcase__control" style={{ display: "block" }}>
          <SchemaInfoButton schema={chatMessageSchema} packageName="Twitch" />
        </div>
      </section>
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Execution</span>
        <div class="storybook-showcase__control" style={{ display: "block" }}>
          <SchemaInfoButton schema={switchSceneSchema} packageName="OBS Studio" />
        </div>
      </section>
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Pure</span>
        <div class="storybook-showcase__control" style={{ display: "block" }}>
          <SchemaInfoButton schema={containsSchema} packageName="Utilities" />
        </div>
      </section>
    </div>
  ),
};
