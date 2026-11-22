import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { stylexProps } from "@macrograph/module/vite";
import { sharedLibraries } from "@macrograph/vite-shared-libraries/SharedLibrariesPlugin";
import { layerAnchors, stylexOptions } from "@macrograph/vite-shared-libraries/StyleX";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig, type UserConfig } from "vite";

export default defineConfig((): UserConfig => {
  const backend = process.env.MACROGRAPH_DEV_SERVER ?? "http://localhost:3001";
  const base = process.env.MACROGRAPH_BASE_PATH ?? "/";
  const prefix = base.replace(/\/$/, "");

  return {
    appType: "spa",
    base,
    plugins: [
      opencode({ skills: ["solidjs"] }),
      Icons(new URL("./src/auto-imports.d.ts", import.meta.url).pathname),
      stylexProps(),
      layerAnchors(),
      stylex.vite(stylexOptions()),
      sharedLibraries(),
      solid().map((plugin) => ({
        ...plugin,
        applyToEnvironment(environment) {
          if (environment.name === "server") return false;
          return plugin.applyToEnvironment?.(environment) ?? true;
        },
      })),
    ],
    server: {
      port: 5174,
      strictPort: true,
      allowedHosts: true,
      proxy: Object.fromEntries(
        ["/health", "/auth", "/api", "/rpc", "/rpc-ws", "/module"].map((path) => [
          `${prefix}${path}`,
          { target: backend, changeOrigin: true, ws: true },
        ]),
      ),
    },
    preview: { port: 4174, strictPort: true },
  };
});
