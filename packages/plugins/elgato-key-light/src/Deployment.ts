import { Engine } from "@macrograph/plugin";

import layer from "./Engine.ts";
import plugin from "./Plugin.ts";

export default Engine.deployment(plugin, layer);
