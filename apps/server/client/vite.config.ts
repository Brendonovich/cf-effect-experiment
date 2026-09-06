import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { moduleSettings, stylexProps } from "@macrograph/module/vite";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig, type UserConfig } from "vite";

export const serverModules = new Set([
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
export default defineConfig((): UserConfig => {
  const backend = process.env.MACROGRAPH_DEV_SERVER ?? "http://localhost:3001";
  const base = process.env.MACROGRAPH_BASE_PATH ?? "/";
  const prefix = base.replace(/\/$/, "");

  return {
    appType: "spa",
    base,
    plugins: [
      opencode({ skills: ["solidjs"] }),
      moduleSettings(undefined, serverModules),
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
        ["/health", "/auth", "/rpc", "/rpc-ws", "/module"].map((path) => [
          `${prefix}${path}`,
          { target: backend, changeOrigin: true, ws: true },
        ]),
      ),
    },
    preview: { port: 4174, strictPort: true },
  };
});
