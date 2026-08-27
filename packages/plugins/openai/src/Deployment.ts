import { Engine } from "@macrograph/plugin";

import OpenAIEngineLive from "./Engine.ts";
import OpenAIPlugin from "./Plugin.ts";

export default Engine.deployment(OpenAIPlugin, OpenAIEngineLive);
