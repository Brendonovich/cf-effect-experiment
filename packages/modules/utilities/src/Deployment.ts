import * as Engine from "@macrograph/module/Engine";

import UtilitiesEngineLive from "./Engine.ts";
import UtilitiesModule from "./Module.ts";

export default Engine.deployment(UtilitiesModule, UtilitiesEngineLive);
