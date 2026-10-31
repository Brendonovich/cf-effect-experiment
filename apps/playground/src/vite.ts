import type { Plugin } from "vite";

import { moduleSettings } from "@macrograph/module/vite";

/** Modules whose settings the playground offers. */
const browserSettings = new Set([
  "@macrograph/module-obs",
  "@macrograph/module-twitch",
  "@macrograph/module-utilities",
  "@macrograph/module-websocket-client",
]);

/** Provides `virtual:macrograph-module-settings` to any app that embeds the playground. */
export const playgroundModuleSettings = (): Plugin => moduleSettings(undefined, browserSettings);
