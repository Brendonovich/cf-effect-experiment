import * as Engine from "@macrograph/module/Engine";

import { localLayer } from "../Engine.ts";
import WebSocketClientModule from "../Module.ts";

export default Engine.deployment(WebSocketClientModule, localLayer);
