import { Engine } from "@macrograph/plugin";

import HttpClientEngineLive from "./Engine.ts";
import HttpClientPlugin from "./Plugin.ts";

export default Engine.deployment(HttpClientPlugin, HttpClientEngineLive);
