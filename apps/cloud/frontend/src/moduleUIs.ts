import type { StaticModuleUI } from "@macrograph/editor-ui/modules";

import { Module } from "@macrograph/module";

/** UI entries of the modules the cloud runs, imported when the editor first needs them. */
export const moduleUIs: ReadonlyMap<string, StaticModuleUI> = new Map<string, StaticModuleUI>([
  [Module.builtinId("discord"), () => import("@macrograph/module-discord/UI")],
  [Module.builtinId("elevenlabs"), () => import("@macrograph/module-elevenlabs/UI")],
  [Module.builtinId("github"), () => import("@macrograph/module-github/UI")],
  [Module.builtinId("kofi"), () => import("@macrograph/module-kofi/UI")],
  [Module.builtinId("openai"), () => import("@macrograph/module-openai/UI")],
  [Module.builtinId("opencode"), () => import("@macrograph/module-opencode/UI")],
  [Module.builtinId("sendblue"), () => import("@macrograph/module-sendblue/UI")],
  [Module.builtinId("twitch"), () => import("@macrograph/module-twitch/UI")],
]);
