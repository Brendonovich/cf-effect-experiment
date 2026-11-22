import { NodeChildProcessSpawner } from "@effect/platform-node";
import { Engine } from "@macrograph/module";
import { Layer } from "effect";

import layer from "./Engine.ts";
import module from "./Module.ts";

export default Engine.deployment(module, layer.pipe(Layer.provide(NodeChildProcessSpawner.layer)));
