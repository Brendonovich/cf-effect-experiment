import * as Module from "@macrograph/module/Module";

import { register } from "./Catalog.ts";
import { TwitchEngine } from "./Definition.ts";

export default Module.make({
  id: "twitch",
  name: "Twitch",
  engine: TwitchEngine,
  effect: register,
});
