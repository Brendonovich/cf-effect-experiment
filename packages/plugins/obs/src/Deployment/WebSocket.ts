import { Engine } from "@macrograph/plugin";

import OBSEngineLive from "../Engine.ts";
import OBSPlugin from "../Plugin.ts";

export default Engine.deployment(OBSPlugin, OBSEngineLive);
