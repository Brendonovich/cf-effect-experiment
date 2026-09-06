import * as Engine from "@macrograph/module/Engine";

import { localLayer } from "../Engine.ts";
import HttpClientModule from "../Module.ts";

export default Engine.deployment(HttpClientModule, localLayer);
