import { parentPort, workerData } from "node:worker_threads";

import { UiBuild } from "./UiBuild.ts";

const options: UiBuild.Options = workerData;

const result: UiBuild.WorkerResult = await UiBuild.run(options).then(
  (output) => ({ ok: true, output: { moduleIds: [...output.moduleIds] } }),
  (error: unknown) => ({
    ok: false,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  }),
);
parentPort?.postMessage(result);
