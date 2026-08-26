import { Engine } from "@macrograph/plugin";

import WebSocketClientEngineLive from "./Engine.ts";
import WebSocketClientPlugin from "./Plugin.ts";

export default Engine.deployment(
  WebSocketClientPlugin,
  WebSocketClientEngineLive,
);
