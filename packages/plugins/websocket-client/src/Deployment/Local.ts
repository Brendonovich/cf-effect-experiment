import * as Engine from "@macrograph/plugin/Engine";

import { localLayer } from "../Engine.ts";
import WebSocketClientPlugin from "../Plugin.ts";

export default Engine.deployment(WebSocketClientPlugin, localLayer);
