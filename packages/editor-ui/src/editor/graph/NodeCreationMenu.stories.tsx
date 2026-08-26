import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { noop, packages } from "../storybook-fixtures";
import { NodeCreationMenu } from "./NodeCreationMenu";

const meta: Meta<typeof NodeCreationMenu> = {
  title: "Editor/Graph/NodeCreationMenu",
  component: NodeCreationMenu,
  args: {
    packages,
    screenPosition: { x: 40, y: 40 },
    onCreate: noop,
    onClose: noop,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "420px", width: "380px" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NodeCreationMenu>;

export const HasEvents: Story = {};
export const Empty: Story = { args: { packages: [] } };
