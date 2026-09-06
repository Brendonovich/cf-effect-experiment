import { Engine } from "@macrograph/module";
import listener from "@macrograph/module-websocket-server/Listener/Node";
import { Layer } from "effect";

import layer from "./Engine.ts";
import module from "./Module.ts";

export default Engine.deployment(module, layer.pipe(Layer.provide(listener)));
