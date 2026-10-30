import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { stylexProps } from "@macrograph/module/vite";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

// `pnpm alchemy dev` serves WebsiteWorker, which owns every /api and /auth route.
const workerUrl = process.env.VITE_WEBSITE_WORKER_URL ?? "http://localhost:1339";

export default defineConfig({
  appType: "spa",
  build: { sourcemap: true },
  plugins: [
    opencode({ skills: ["solidjs"] }),
    Icons(new URL("./src/auto-imports.d.ts", import.meta.url).pathname),
    stylexProps(),
    stylex.vite({
      sxPropName: false,
      useCSSLayers: { before: ["reset"], prefix: "stylex" },
      runtimeInjection: false,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: new URL("../..", import.meta.url).pathname,
      },
    }),
    solid(),
  ],
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      "/api": { target: workerUrl, changeOrigin: true },
      "/auth": { target: workerUrl, changeOrigin: true },
    },
  },
  preview: { port: 4176, strictPort: true },
});
