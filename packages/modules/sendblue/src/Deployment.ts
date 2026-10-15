import { Engine } from "@macrograph/module";

import SendblueEngineLive from "./Engine.ts";
import SendblueModule from "./Module.ts";
import { handler, requirements } from "./Polling.ts";

export default Engine.withPollingIngress(Engine.deployment(SendblueModule, SendblueEngineLive), {
  handlers: [handler],
  requirements,
});
