import { Engine } from "@macrograph/module";

import HttpClientEngineLive from "./Engine.ts";
import HttpClientModule from "./Module.ts";

export default Engine.deployment(HttpClientModule, HttpClientEngineLive);
