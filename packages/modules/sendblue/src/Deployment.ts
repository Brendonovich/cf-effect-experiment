import { Engine } from "@macrograph/module";

import SendblueEngineLive from "./Engine.ts";
import SendblueModule from "./Module.ts";

export default Engine.deployment(SendblueModule, SendblueEngineLive);
