import * as Engine from "@macrograph/module/Engine";

import { makeLayer, type Service } from "../Engine/Cloudflare.ts";
import OpenCodeModule from "../Module.ts";

export const make = (service: Service) => Engine.deployment(OpenCodeModule, makeLayer(service));
