import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { pluginSettings, stylexProps } from "@macrograph/plugin/vite";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig, type UserConfig } from "vite";

export const serverPlugins = new Set([
  "@macrograph/plugin-http-client",
  "@macrograph/plugin-obs",
  "@macrograph/plugin-twitch",
  "@macrograph/plugin-utilities",
  "@macrograph/plugin-websocket-client",
  "@macrograph/plugin-websocket-server",
]);
export default defineConfig((): UserConfig => {
  const backend = process.env.MACROGRAPH_DEV_SERVER ?? "http://localhost:3001";
  const base = process.env.MACROGRAPH_BASE_PATH ?? "/";
  const prefix = base.replace(/\/$/, "");

  return {
    appType: "spa",
    base,
    plugins: [
      opencode({ skills: ["solidjs"] }),
      pluginSettings(undefined, serverPlugins),
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
        ["/health", "/auth", "/rpc", "/rpc-ws", "/plugin"].map((path) => [
          `${prefix}${path}`,
          { target: backend, changeOrigin: true, ws: true },
        ]),
      ),
    },
    preview: { port: 4174, strictPort: true },
  };
});
