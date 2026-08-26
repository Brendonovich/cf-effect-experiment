import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { pluginSettings, stylexProps } from "@macrograph/plugin/vite";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

const cloudSettings = new Set(["@macrograph/plugin-kofi", "@macrograph/plugin-twitch"]);
const workerUrl =
  process.env.VITE_WORKER_URL ??
  "https://cloudflare-mainworker-dev-brendonovich5egibymynq36yh4t.brendonovich.workers.dev";
const publicIngressOrigin = new URL(
  process.env.VITE_PUBLIC_INGRESS_ORIGIN ?? process.env.VITE_PUBLIC_WORKER_ORIGIN ?? workerUrl,
).origin;
const proxyHeaders = { "x-macrograph-public-origin": publicIngressOrigin };

export default defineConfig({
  appType: "spa",
  base: process.env.MACROGRAPH_BASE_PATH ?? "/",
  build: { sourcemap: true },
  plugins: [
    opencode({ skills: ["solidjs"] }),
    pluginSettings(undefined, cloudSettings),
    Icons(new URL("./src/auto-imports.d.ts", import.meta.url).pathname),
    stylexProps(),
    stylex.vite({
      sxPropName: false,
      useCSSLayers: { before: ["reset"], prefix: "stylex" },
      runtimeInjection: false,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: new URL("../../..", import.meta.url).pathname,
      },
    }),
    solid(),
  ],
  server: {
    port: 5175,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": { target: workerUrl, changeOrigin: true, headers: proxyHeaders, xfwd: true },
      "/rpc": {
        target: workerUrl,
        changeOrigin: true,
        headers: proxyHeaders,
        ws: true,
        xfwd: true,
      },
    },
  },
  preview: { port: 4175, strictPort: true },
});
