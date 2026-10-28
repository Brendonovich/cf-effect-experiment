import type { Plugin } from "vite";

const browserImportAudit: Plugin = {
  name: "macrograph-browser-import-audit",
  // The server bundle runs in a Worker; only what ships to browsers is audited.
  applyToEnvironment: (environment) => environment.name === "client",
  generateBundle(_options, bundle) {
    const forbidden = [
      "/apps/cloud/",
      "/apps/server/",
      "/packages/cloud-api/",
      "/packages/persistence-sqlite/",
      "/packages/modules/kofi/",
      "/packages/module-host/src/ModuleRegistry.ts",
      "/packages/module-host/src/ModuleSources.ts",
      "/packages/module-host/src/VmLoader.ts",
      "/packages/module-host/src/NativeAddons.ts",
      "/packages/module-host/src/ModuleWatcher.ts",
      "/packages/module/src/HttpIngress",
      "/packages/modules/twitch/src/Deployment/Webhook",
      "/packages/modules/twitch/src/WebhookEventSub",
      "/packages/modules/websocket-server/",
      "/@effect/platform-node/",
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
      "/apps/website/src/playground/local/BrowserServices.ts",
      "/packages/module-host/src/StaticRegistry.ts",
      "/packages/module-host/src/ModuleRegistryCore.ts",
    ];
    for (const expected of required) {
      if (!modules.some((id) => id.includes(expected)))
        throw new Error(`Browser bundle is missing required module ${expected}`);
    }
  },
};

/**
 * The playground's build plugins: a check that the browser bundle has the modules it runs and
 * nothing that only works on a server.
 */
export const playground = (): Plugin[] => [browserImportAudit];
