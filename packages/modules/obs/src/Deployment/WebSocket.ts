import * as Engine from "@macrograph/module/Engine";

import OBSEngineLive from "../Engine.ts";
import OBSModule from "../Module.ts";

export default Engine.deployment(OBSModule, OBSEngineLive);
