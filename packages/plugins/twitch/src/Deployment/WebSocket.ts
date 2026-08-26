import * as Engine from "@macrograph/plugin/Engine";

import { make as makeEngine } from "../Engine.ts";
import TwitchPlugin from "../Plugin.ts";
import { make as makeEventSub } from "../WebSocketEventSub.ts";

export default Engine.deployment(TwitchPlugin, makeEngine(makeEventSub));
