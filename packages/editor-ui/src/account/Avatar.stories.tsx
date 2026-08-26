import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Avatar } from "./Avatar";

const meta: Meta<typeof Avatar> = {
  title: "Editor/Controls/Avatar",
  component: Avatar,
  args: { email: "brendon@example.com" },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Variants: Story = {
  render: () => (
    <div class="storybook-showcase storybook-showcase--controls">
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Default</span>
        <div class="storybook-showcase__control">
          <Avatar email="brendon@example.com" />
        </div>
      </section>
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Alternate user</span>
        <div class="storybook-showcase__control">
          <Avatar email="streamer@macrograph.app" />
        </div>
      </section>
      <section class="storybook-showcase__item">
        <span class="storybook-showcase__label">Collaborators</span>
        <div class="storybook-showcase__control" style={{ gap: "8px" }}>
          <Avatar email="brendon@example.com" />
          <Avatar email="streamer@macrograph.app" />
          <Avatar email="moderator@example.com" />
        </div>
      </section>
    </div>
  ),
};
