import "@macrograph/editor-ui/styles.css";
import "./preview.css";
import type { Preview } from "storybook-solidjs-vite";

document.documentElement.classList.add("dark", "dark-theme");

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        dark: { name: "Dark", value: "#111111" },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: "dark" },
  },
};

export default preview;
