import * as Cloudflare from "alchemy/Cloudflare";
import { Queue } from "@macrograph/core";

import type * as CloudWorkerOperations from "./CloudWorkerOperations.ts";

export class IngressWorker extends Cloudflare.Worker<
  IngressWorker,
  CloudWorkerOperations.Service
>()("IngressWorker") {}
