import { Engine } from "@macrograph/module";

import { localLayer } from "./Engine.ts";
import nodeListenerLayer from "./Listener/Node.ts";
import WebSocketServerModule from "./Module.ts";

export default Engine.deployment(WebSocketServerModule, localLayer(nodeListenerLayer));
