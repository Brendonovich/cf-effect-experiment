import * as Engine from "@macrograph/plugin/Engine";

import layer from "./Engine.ts";
import plugin from "./Plugin.ts";

export default Engine.deployment(plugin, layer);
