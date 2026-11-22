import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { stylexProps } from "@macrograph/module/vite";
import { layerAnchors, stylexOptions } from "@macrograph/vite-shared-libraries/StyleX";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    opencode({ skills: ["solidjs"] }),
    Icons(new URL("./src/auto-imports.d.ts", import.meta.url).pathname),
    stylexProps(),
    layerAnchors(),
    stylex.vite(stylexOptions()),
    solid(),
  ],
});
