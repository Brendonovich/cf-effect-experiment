import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const workerUrl =
  process.env.VITE_WORKER_URL ??
  "https://cloudflare-mainworker-dev-brendonovich5egibymynq36yh4t.brendonovich.workers.dev";

export default defineConfig({
  plugins: [tailwindcss(), solid()],
  server: {
    allowedHosts: ["brendan-box"],
    proxy: workerUrl
      ? {
          "/rpc": {
            target: workerUrl,
            changeOrigin: true,
            ws: true,
          },
        }
      : undefined,
  },
});
