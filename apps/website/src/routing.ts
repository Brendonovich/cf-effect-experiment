import type { WorkerBindings } from "./api";

/** The canonical host; browsers on the others are redirected to it. */
const canonicalHost = "macrograph.app";
const legacyBrowserHosts = new Set(["www.macrograph.app"]);

/** Paths WebsiteWorker serves; kept in step with its Worker Routes. */
export const isApiPath = (pathname: string) =>
  pathname.startsWith("/api/") ||
  pathname.startsWith("/auth/") ||
  pathname === "/.well-known/oauth-authorization-server";

/** Paths CloudWorker serves; kept in step with `apps/cloud/src/api/CloudMount.ts`. */
export const isCloudPath = (pathname: string) =>
  pathname === "/cloud" ||
  pathname.startsWith("/cloud/") ||
  pathname === "/.well-known/oauth-authorization-server/cloud" ||
  pathname.startsWith("/.well-known/oauth-protected-resource/cloud/");

/** Kept in step with `apps/cloud/src/website/PreviewAuth.ts`. */
const gateCheckHeader = "x-macrograph-preview-gate";

/**
 * On previews, WebsiteWorker decides who gets in. Asks it about this request (without its body)
 * and returns its answer unless the visitor is allowed.
 */
const previewDenial = async (request: Request, env: WorkerBindings) => {
  if (env.PREVIEW_GATE === undefined) return undefined;
  if (env.API === undefined) return new Response(null, { status: 503 });
  const headers = new Headers(request.headers);
  headers.set(gateCheckHeader, "1");
  const answer = await env.API.fetch(new Request(request.url, { method: request.method, headers }));
  return answer.status === 204 ? undefined : answer;
};

/** Sends a request to the API, Cloud, the canonical host, or the page renderer. */
export const route = async (
  request: Request,
  env: WorkerBindings,
  render: (request: Request) => Promise<Response>,
): Promise<Response> => {
  const url = new URL(request.url);
  // The API gates its own paths.
  if (isApiPath(url.pathname))
    return env.API?.fetch(request) ?? new Response(null, { status: 503 });
  const denied = await previewDenial(request, env);
  if (denied !== undefined) return denied;
  if (isCloudPath(url.pathname))
    return env.CLOUD?.fetch(request) ?? new Response(null, { status: 503 });
  if (
    legacyBrowserHosts.has(url.hostname) &&
    (request.method === "GET" || request.method === "HEAD")
  )
    return Response.redirect(`https://${canonicalHost}${url.pathname}${url.search}`, 301);
  return render(request);
};
