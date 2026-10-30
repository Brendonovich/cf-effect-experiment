import * as Engine from "@macrograph/module/Engine";

import OpenCodeEngineLive from "../Engine/Server.ts";
import OpenCodeModule from "../Module.ts";

export default Engine.deployment(OpenCodeModule, OpenCodeEngineLive);
