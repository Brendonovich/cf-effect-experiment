import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { OBSEngine } from "./Definition.ts";
import { register } from "./Catalog.ts";

export default Module.make({
  id: "obs",
  name: "OBS Studio",
  engine: OBSEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* register(context);
  }),
});
