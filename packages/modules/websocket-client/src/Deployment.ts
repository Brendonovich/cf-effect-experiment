import { Engine } from "@macrograph/module";

import WebSocketClientEngineLive from "./Engine.ts";
import WebSocketClientModule from "./Module.ts";

export default Engine.deployment(
  WebSocketClientModule,
  WebSocketClientEngineLive,
);
