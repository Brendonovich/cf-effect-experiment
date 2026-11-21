import * as Engine from "@macrograph/module/Engine";
import { Layer } from "effect";

import { runtimeLayer } from "../Engine.ts";
import KeyboardModule from "../Module.ts";
import * as BrowserTransport from "../Transport/Browser.ts";

export default Engine.deployment(
  KeyboardModule,
  runtimeLayer.pipe(Layer.provide(BrowserTransport.layer)),
);
