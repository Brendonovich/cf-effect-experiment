import { Engine } from "@macrograph/module";

import OpenAIEngineLive from "./Engine.ts";
import OpenAIModule from "./Module.ts";

export default Engine.deployment(OpenAIModule, OpenAIEngineLive);
