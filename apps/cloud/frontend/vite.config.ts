import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { stylexProps } from "@macrograph/module/vite";
import { layerAnchors, stylexOptions } from "@macrograph/vite-shared-libraries/StyleX";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

const workerUrl =
  process.env.VITE_WORKER_URL ??
  "https://cloudflare-mainworker-dev-brendonovich5egibymynq36yh4t.brendonovich.workers.dev";
const publicIngressOrigin = new URL(
  process.env.VITE_PUBLIC_INGRESS_ORIGIN ?? process.env.VITE_PUBLIC_WORKER_ORIGIN ?? workerUrl,
).origin;
// Cloud is mounted at `/cloud` on the main site. The worker strips the mount itself, as it does
// for requests its Worker Routes receive in production.
const basePath = process.env.MACROGRAPH_BASE_PATH ?? "/cloud/";
const mount = basePath.replace(/\/+$/, "");
const proxyHeaders = { "x-macrograph-public-origin": publicIngressOrigin };

export default defineConfig({
  appType: "spa",
  base: basePath,
  build: { sourcemap: true },
  plugins: [
    opencode({ skills: ["solidjs"] }),
    Icons(new URL("./src/auto-imports.d.ts", import.meta.url).pathname),
    stylexProps(),
    layerAnchors(),
    stylex.vite(stylexOptions()),
    solid(),
  ],
  server: {
    port: 5175,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      [`${mount}/api`]: {
        target: workerUrl,
        changeOrigin: true,
        headers: proxyHeaders,
        xfwd: true,
      },
      [`${mount}/oauth`]: {
        target: workerUrl,
        changeOrigin: true,
        headers: proxyHeaders,
        xfwd: true,
      },
      [`${mount}/rpc`]: {
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
