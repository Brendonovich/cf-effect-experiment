import { Icons } from "@macrograph/icons/vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const workerUrl =
  process.env.VITE_WORKER_URL ??
  "https://cloudflare-mainworker-dev-brendonovich5egibymynq36yh4t.brendonovich.workers.dev";
const publicRuntimeOrigin = new URL("/runtime", process.env.VITE_PUBLIC_RUNTIME_ORIGIN ?? workerUrl)
  .href;
const proxyHeaders = { "x-macrograph-public-origin": publicRuntimeOrigin };

export default defineConfig({
  plugins: [Icons(), tailwindcss(), solid()],
  server: {
    allowedHosts: ["brendan-box"],
    proxy: workerUrl
      ? {
          "/api": {
            target: workerUrl,
            changeOrigin: true,
            headers: proxyHeaders,
          },
          "/rpc": {
            target: workerUrl,
            changeOrigin: true,
            headers: proxyHeaders,
            ws: true,
          },
        }
      : undefined,
  },
});
