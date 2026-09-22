/// <reference types="@cloudflare/workers-types" />
import type { WorkflowStep } from "cloudflare:workers";

import { CloudflareRuntime } from "../src/index.ts";

// Keep the structural adapter compatible with the real platform's serializable
// result constraint without importing Cloudflare globals into the runtime.
export const nativeTask = (step: WorkflowStep) => CloudflareRuntime.makeTask(step);
