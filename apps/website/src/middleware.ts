import { getRequestEvent } from "@solidjs/web";

import { embedQueryState } from "./queryState";

/** Runs around every page render; see `queryState.ts`. */
export default async function queryState(_request: Request, next: () => Promise<Response>) {
  const response = await next();
  const locals = getRequestEvent()?.locals;
  if (locals === undefined || !(response.headers.get("content-type") ?? "").includes("text/html"))
    return response;
  // `renderMode: "async"` means the body is the complete page, so every query has settled.
  const html = embedQueryState(await response.text(), locals);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
