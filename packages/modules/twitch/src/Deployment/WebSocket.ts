import * as Engine from "@macrograph/module/Engine";

import { make as makeEngine } from "../Engine.ts";
import TwitchModule from "../Module.ts";
import { make as makeEventSub } from "../WebSocketEventSub.ts";

export default Engine.deployment(TwitchModule, makeEngine(makeEventSub));
