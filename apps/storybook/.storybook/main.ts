import type { StorybookConfig } from "storybook-solidjs-vite";

const config: StorybookConfig = {
  stories: [
    "../../../packages/editor-ui/src/**/*.stories.@(ts|tsx)",
    "../../../packages/plugins/*/src/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "storybook-solidjs-vite",
    options: {},
  },
};

export default config;
