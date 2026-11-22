import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { stylexProps } from "@macrograph/module/vite";
import { layerAnchors, stylexOptions } from "@macrograph/vite-shared-libraries/StyleX";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

import { reference } from "./reference/vite";
import { playground } from "./src/playground/vite";

// `pnpm alchemy dev` serves WebsiteWorker, which owns every /api and /auth route. Cloud's dev
// server serves `/cloud`, as WebsiteWorker forwards it in production.
const workerUrl = process.env.VITE_WEBSITE_WORKER_URL ?? "http://localhost:1339";
const cloudUrl = process.env.VITE_CLOUD_DEV_URL ?? "http://localhost:5175";

export default defineConfig({
  build: { sourcemap: true },
  // Workspace packages ship TypeScript source, which the server render must compile, not import.
  ssr: { noExternal: [/^@macrograph\//] },
  plugins: [
    opencode({ skills: ["solidjs"] }),
    Icons(new URL("./src/auto-imports.d.ts", import.meta.url).pathname),
    ...playground(),
    reference(),
    stylexProps(),
    layerAnchors(),
    stylex.vite(stylexOptions()),
    // Start mode server-renders every page (`src/Document.tsx` + `src/App.tsx`) and, deployed,
    // runs `src/worker.ts`. `async` sends each page complete instead of streaming fallbacks.
    // Tests render components directly, so they keep the plain client transform.
    solid(
      process.env.VITEST
        ? {}
        : { start: { renderMode: "async", middleware: "./src/middleware.ts" }, ssr: true },
    ),
  ],
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      "/api": { target: workerUrl, changeOrigin: true },
      "/auth": { target: workerUrl, changeOrigin: true },
      "/oauth": { target: workerUrl, changeOrigin: true },
      "/.well-known/oauth-authorization-server": { target: workerUrl, changeOrigin: true },
      "/cloud": { target: cloudUrl, ws: true },
    },
  },
  preview: { port: 4176, strictPort: true },
});
