import { Engine } from "@macrograph/plugin";

import { localLayer } from "./Engine.ts";
import nodeListenerLayer from "./Listener/Node.ts";
import WebSocketServerPlugin from "./Plugin.ts";

export default Engine.deployment(WebSocketServerPlugin, localLayer(nodeListenerLayer));
