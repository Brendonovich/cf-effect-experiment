import { defineConfig } from "rolldown";
import { pluginDeployments } from "@macrograph/plugin/vite";

const serverDeployments = new Set([
  "@macrograph/plugin-http-client",
  "@macrograph/plugin-obs",
  "@macrograph/plugin-twitch",
  "@macrograph/plugin-utilities",
  "@macrograph/plugin-websocket-client",
  "@macrograph/plugin-websocket-server",
]);

export default defineConfig({
  platform: "node",
  plugins: [pluginDeployments(undefined, serverDeployments)],
  input: "src/index.ts",
  output: {
    dir: "dist/esm",
    format: "esm",
    minify: false,
  },
});
