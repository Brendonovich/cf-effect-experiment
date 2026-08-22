import { Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { OBSEngine } from "./Definition.ts";

export default Plugin.make({
  id: "obs",
  name: "OBS Studio",
  engine: OBSEngine,
  effect: Effect.fnUntraced(function* () {}),
});
