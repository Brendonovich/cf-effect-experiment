import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Button, ButtonLink } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Editor/Controls/Button",
  component: Button,
  args: { children: "Save changes", size: "md", variant: "primary" },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "md"] },
    variant: { control: "inline-radio", options: ["primary", "secondary", "ghost", "text"] },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Variants: Story = {
  render: () => (
    <div class="storybook-showcase storybook-showcase--controls">
      {(["primary", "secondary", "ghost", "text"] as const).map((variant) => (
        <section class="storybook-showcase__item">
          <span class="storybook-showcase__label">{variant}</span>
          <div class="storybook-showcase__control">
            <Button variant={variant} size="md">
              Medium
            </Button>
          </div>
          <div class="storybook-showcase__control">
            <Button variant={variant} size="sm">
              Small
            </Button>
          </div>
          <div class="storybook-showcase__control">
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </div>
          <div class="storybook-showcase__control">
            <ButtonLink
              variant={variant}
              href="https://macrograph.app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Link
            </ButtonLink>
          </div>
        </section>
      ))}
    </div>
  ),
};
