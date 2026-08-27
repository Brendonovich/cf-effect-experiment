import { Engine } from "@macrograph/plugin";

import ElevenLabsEngineLive from "./Engine.ts";
import ElevenLabsPlugin from "./Plugin.ts";

export default Engine.deployment(ElevenLabsPlugin, ElevenLabsEngineLive);
