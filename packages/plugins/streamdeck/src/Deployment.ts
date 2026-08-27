import { Engine } from "@macrograph/plugin";
import listener from "@macrograph/plugin-websocket-server/Listener/Node";
import { Layer } from "effect";

import layer from "./Engine.ts";
import plugin from "./Plugin.ts";

export default Engine.deployment(plugin, layer.pipe(Layer.provide(listener)));
