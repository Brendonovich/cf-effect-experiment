/**
 * The website's Worker: server-renders every page. In production WebsiteWorker (the API) and
 * CloudWorker claim their paths with Worker Routes before requests get here; stages without a
 * public host have no routes, so `routing.ts` forwards those paths over service bindings instead.
 */
import { handleRequest } from "virtual:solid-ssr-handler";

import type { WorkerBindings } from "./api";

import { route } from "./routing";

export default {
  fetch: (request: Request, env: WorkerBindings) =>
    // Pages read the bindings through `getRequestEvent().nativeEvent` to call the API.
    route(request, env, (page) => handleRequest(page, { event: { nativeEvent: { env } } })),
};
