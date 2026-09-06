import opencode from "@brendonovich/vite-plugin-opencode";
import { Icons } from "@macrograph/icons/vite";
import { moduleSettings, stylexProps } from "@macrograph/module/vite";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig, type Plugin } from "vite";

const browserSettings = new Set([
  "@macrograph/module-obs",
  "@macrograph/module-twitch",
  "@macrograph/module-utilities",
  "@macrograph/module-websocket-client",
]);
const browserImportAudit: Plugin = {
  name: "macrograph-browser-import-audit",
  generateBundle(_options, bundle) {
    const forbidden = [
      "/apps/cloudflare/",
      "/apps/server/",
      "/packages/cloud-api/",
      "/packages/persistence-sqlite/",
      "/packages/modules/kofi/",
      "/packages/module/src/HttpIngress",
      "/packages/modules/twitch/src/Deployment/Webhook",
      "/packages/modules/twitch/src/WebhookEventSub",
      "/packages/modules/websocket-server/",
      "/@effect/platform-node/",
      "/@effect/platform-bun/",
    ];
    const polyfills = ["node-stdlib-browser", "node-polyfill", "rollup-plugin-polyfill-node"];
    const invalid = Object.values(bundle).flatMap((output) => {
      if (output.type !== "chunk") return [];
      const ids = [...Object.keys(output.modules), ...output.imports, ...output.dynamicImports];
      return ids.filter(
        (id) =>
          id.startsWith("node:") ||
          id.includes("__vite-browser-external") ||
          forbidden.some((part) => id.replaceAll("\\", "/").includes(part)) ||
          polyfills.some((part) => id.includes(part)),
      );
    });
    if (invalid.length > 0)
      throw new Error(`Browser bundle contains forbidden imports:\n${invalid.join("\n")}`);
    const forbiddenCredentialFlows = [
      "id.twitch.tv/oauth2/authorize",
      "id.twitch.tv/oauth2/token",
      "code_verifier",
      "session-only",
    ];
    const credentialFlow = Object.values(bundle).find(
      (output) =>
        output.type === "chunk" &&
        forbiddenCredentialFlows.some((value) => output.code.includes(value)),
    );
    if (credentialFlow !== undefined)
      throw new Error("Browser bundle contains an obsolete direct Twitch credential flow");
    const modules = Object.values(bundle).flatMap((output) =>
      output.type === "chunk"
        ? Object.keys(output.modules).map((id) => id.replaceAll("\\", "/"))
        : [],
    );
    const required = [
      "/packages/modules/obs/src/Engine.ts",
      "/packages/modules/twitch/src/Engine.ts",
      "/packages/modules/twitch/src/WebSocketEventSub.ts",
      "/packages/modules/websocket-client/src/Engine.ts",
      "/apps/playground/src/local/BrowserCredentials.ts",
      "/apps/playground/src/local/BrowserServices.ts",
    ];
    for (const expected of required) {
      if (!modules.some((id) => id.includes(expected)))
        throw new Error(`Browser bundle is missing required module ${expected}`);
    }
  },
};

export default defineConfig({
  appType: "spa",
  base: process.env.MACROGRAPH_BASE_PATH ?? "/",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/__macrograph_credentials": {
        target: "https://www.macrograph.app",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__macrograph_credentials/, "/api"),
      },
    },
  },
  preview: { port: 4173, strictPort: true },
  plugins: [
    opencode({ skills: ["solidjs"] }),
    moduleSettings(undefined, browserSettings),
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
    browserImportAudit,
  ],
});
