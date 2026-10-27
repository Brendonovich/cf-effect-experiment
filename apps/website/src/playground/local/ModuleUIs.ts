import type { StaticModuleUI } from "@macrograph/editor-ui/modules";

import * as Module from "@macrograph/module/Module";

/** UI entries of the bundled modules, imported when the editor first needs them. */
export const moduleUIs: ReadonlyMap<string, StaticModuleUI> = new Map<string, StaticModuleUI>([
  [Module.builtinId("obs"), () => import("@macrograph/module-obs/UI")],
  [Module.builtinId("twitch"), () => import("@macrograph/module-twitch/UI")],
  [Module.builtinId("utilities"), () => import("@macrograph/module-utilities/UI")],
  [Module.builtinId("websocket-client"), () => import("@macrograph/module-websocket-client/UI")],
]);
