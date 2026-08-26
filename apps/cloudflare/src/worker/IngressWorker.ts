import * as Cloudflare from "alchemy/Cloudflare";

import type * as CloudWorkerOperations from "./CloudWorkerOperations.ts";

export class IngressWorker extends Cloudflare.Worker<
  IngressWorker,
  CloudWorkerOperations.Service
>()("IngressWorker") {}
