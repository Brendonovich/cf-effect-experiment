import * as Cloudflare from "alchemy/Cloudflare";

import type OpenCodeDO from "../opencode/OpenCodeDO.ts";
import type * as CloudWorkerOperations from "./CloudWorkerOperations.ts";

/** Hosts production execution, including each managed OpenCode connection's instance. */
export class IngressWorker extends Cloudflare.Worker<
  IngressWorker,
  CloudWorkerOperations.Service,
  OpenCodeDO
>()("IngressWorker") {}
