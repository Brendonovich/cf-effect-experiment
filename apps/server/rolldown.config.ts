import { moduleDeployments } from "@macrograph/module/vite";
import { defineConfig } from "rolldown";

const serverDeployments = new Set([
  "@macrograph/module-http-client",
  "@macrograph/module-obs",
  "@macrograph/module-twitch",
  "@macrograph/module-utilities",
  "@macrograph/module-websocket-client",
  "@macrograph/module-websocket-server",
  "@macrograph/module-discord",
  "@macrograph/module-elevenlabs",
  "@macrograph/module-elgato-key-light",
  "@macrograph/module-fs",
  "@macrograph/module-goxlr",
  "@macrograph/module-ikea-tradfri",
  "@macrograph/module-json",
  "@macrograph/module-lifx",
  "@macrograph/module-list",
  "@macrograph/module-logic",
  "@macrograph/module-math",
  "@macrograph/module-openai",
  "@macrograph/module-shell",
  "@macrograph/module-speakerbot",
  "@macrograph/module-streamdeck",
  "@macrograph/module-streamlabs",
  "@macrograph/module-string",
  "@macrograph/module-tiktok-euler-stream",
  "@macrograph/module-voicemod",
  "@macrograph/module-vtube-studio",
]);

export default defineConfig({
  platform: "node",
  plugins: [moduleDeployments(undefined, serverDeployments)],
  input: "src/index.ts",
  output: {
    dir: "dist/esm",
    format: "esm",
    minify: false,
  },
});
