import * as Cloudflare from "@alchemy.run/cloudflare";

import type GatewayDO from "../gateway/GatewayDO.ts";
import type OpenCodeDO from "../opencode/OpenCodeDO.ts";
import type * as CloudWorkerOperations from "./CloudWorkerOperations.ts";

/**
 * Hosts production execution, including each managed OpenCode connection's instance and each
 * user's gateway event listener.
 */
export class IngressWorker extends Cloudflare.Worker<
  IngressWorker,
  CloudWorkerOperations.Service,
  OpenCodeDO | GatewayDO
>()("IngressWorker") {}
