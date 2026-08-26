import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { LoadingState } from "./LoadingState";

const meta: Meta<typeof LoadingState> = {
  title: "Editor/Feedback/LoadingState",
  component: LoadingState,
  args: { label: "Connecting to editor" },
};

export default meta;
type Story = StoryObj<typeof LoadingState>;

export const Variants: Story = {
  render: () => (
    <div class="storybook-showcase storybook-showcase--properties">
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Default</span>
        <div class="storybook-showcase__control" style={{ "justify-content": "center" }}>
          <div style={{ width: "128px" }}>
            <LoadingState label="Connecting to editor" />
          </div>
        </div>
      </section>
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Compact</span>
        <div class="storybook-showcase__control" style={{ "justify-content": "center" }}>
          <div style={{ width: "128px" }}>
            <LoadingState compact label="Loading graph" />
          </div>
        </div>
      </section>
    </div>
  ),
};
