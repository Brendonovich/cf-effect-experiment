import * as Plugin from "@macrograph/plugin/Plugin";

import { register } from "./Catalog.ts";
import { TwitchEngine } from "./Definition.ts";

export default Plugin.make({
  id: "twitch",
  name: "Twitch",
  engine: TwitchEngine,
  effect: register,
});
