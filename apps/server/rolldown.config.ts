import { moduleDeployments } from "@macrograph/module/vite";
import { defineConfig, type OutputOptions, type RolldownOptions } from "rolldown";

const serverDeployments = new Set([
  "@macrograph/module-http-client",
  "@macrograph/module-github",
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
  "@macrograph/module-keyboard",
  "@macrograph/module-lifx",
  "@macrograph/module-list",
  "@macrograph/module-logic",
  "@macrograph/module-math",
  "@macrograph/module-midi",
  "@macrograph/module-openai",
  "@macrograph/module-opencode",
  "@macrograph/module-sendblue",
  "@macrograph/module-shell",
  "@macrograph/module-speakerbot",
  "@macrograph/module-streamdeck",
  "@macrograph/module-streamlabs",
  "@macrograph/module-string",
  "@macrograph/module-tiktok-euler-stream",
  "@macrograph/module-voicemod",
  "@macrograph/module-vtube-studio",
]);

/** The server bundle for a release channel, built from `src/index.ts` in the working directory. */
export const serverBuild = (channel: string): RolldownOptions & { output: OutputOptions } => ({
  platform: "node",
  plugins: [moduleDeployments(undefined, serverDeployments)],
  input: "src/index.ts",
  // The channel the CLI serves unless MACROGRAPH_CHANNEL says otherwise; see src/Channel.ts.
  transform: { define: { MACROGRAPH_CHANNEL: JSON.stringify(channel) } },
  // Native addons; resolved from node_modules at runtime and loaded lazily by their modules.
  external: ["@julusian/midi", "uiohook-napi"],
  output: {
    dir: "dist/esm",
    format: "esm",
    // The entry is the `macrograph` bin.
    banner: (chunk) => (chunk.isEntry ? "#!/usr/bin/env node" : ""),
    minify: false,
  },
});

// Builds are the latest channel unless built with MACROGRAPH_CHANNEL.
export default defineConfig(serverBuild(process.env.MACROGRAPH_CHANNEL || "latest"));
