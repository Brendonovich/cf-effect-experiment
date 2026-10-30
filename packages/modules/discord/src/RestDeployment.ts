import { Engine } from "@macrograph/module";

import { restLayer } from "./Engine.ts";
import { restModule } from "./Module.ts";

/** Runs the Discord REST and webhook actions without a gateway connection. */
export default Engine.deployment(restModule, restLayer);
