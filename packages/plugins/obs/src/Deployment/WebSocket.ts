import * as Engine from "@macrograph/plugin/Engine";

import OBSEngineLive from "../Engine.ts";
import OBSPlugin from "../Plugin.ts";

export default Engine.deployment(OBSPlugin, OBSEngineLive);
