import { Engine } from "@macrograph/module";

import ElevenLabsEngineLive from "./Engine.ts";
import ElevenLabsModule from "./Module.ts";

export default Engine.deployment(ElevenLabsModule, ElevenLabsEngineLive);
