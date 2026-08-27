import { pluginDeployments } from "@macrograph/plugin/vite";
import { defineConfig } from "rolldown";

const serverDeployments = new Set([
  "@macrograph/plugin-http-client",
  "@macrograph/plugin-obs",
  "@macrograph/plugin-twitch",
  "@macrograph/plugin-utilities",
  "@macrograph/plugin-websocket-client",
  "@macrograph/plugin-websocket-server",
  "@macrograph/plugin-discord",
  "@macrograph/plugin-elevenlabs",
  "@macrograph/plugin-fs",
  "@macrograph/plugin-goxlr",
  "@macrograph/plugin-json",
  "@macrograph/plugin-list",
  "@macrograph/plugin-logic",
  "@macrograph/plugin-math",
  "@macrograph/plugin-openai",
  "@macrograph/plugin-shell",
  "@macrograph/plugin-speakerbot",
  "@macrograph/plugin-streamdeck",
  "@macrograph/plugin-streamlabs",
  "@macrograph/plugin-string",
  "@macrograph/plugin-voicemod",
  "@macrograph/plugin-vtube-studio",
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
