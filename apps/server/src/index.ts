import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { Main } from "./Server.ts";

Layer.launch(Main).pipe(NodeRuntime.runMain);
