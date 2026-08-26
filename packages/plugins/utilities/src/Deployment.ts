import * as Engine from "@macrograph/plugin/Engine";

import UtilitiesEngineLive from "./Engine.ts";
import UtilitiesPlugin from "./Plugin.ts";

export default Engine.deployment(UtilitiesPlugin, UtilitiesEngineLive);
