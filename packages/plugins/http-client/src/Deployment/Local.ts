import * as Engine from "@macrograph/plugin/Engine";

import { localLayer } from "../Engine.ts";
import HttpClientPlugin from "../Plugin.ts";

export default Engine.deployment(HttpClientPlugin, localLayer);
