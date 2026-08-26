import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { OBSEngine } from "./Definition.ts";
import { register } from "./Catalog.ts";

export default Plugin.make({
  id: "obs",
  name: "OBS Studio",
  engine: OBSEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* register(context);
  }),
});
