export interface OriginRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export const requestOrigin = (request: OriginRequest) => {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  if (host === undefined) return new URL(request.url, "http://localhost:1337").origin;

  const protocol =
    request.headers["x-forwarded-proto"]?.split(",")[0]?.trim() ??
    (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
};

/** The path Cloud is mounted at on the main site, claimed by CloudWorker's Worker Routes. */
export const cloudPathPrefix = "/cloud";

/**
 * The mount CloudWorker stripped from this request, or "" when Cloud was reached directly (its
 * workers.dev URL, or the Vite proxy's own header in development). CloudWorker replaces any
 * client-supplied value, and only the known mount is accepted.
 */
export const forwardedPrefix = (request: OriginRequest) =>
  request.headers["x-forwarded-prefix"] === cloudPathPrefix ? cloudPathPrefix : "";

export const hasTrustedOrigin = (request: OriginRequest) => {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (!URL.canParse(origin)) return false;

  const browserOrigin = new URL(origin);
  const serverOrigin = new URL(requestOrigin(request));
  if (browserOrigin.origin === serverOrigin.origin) return true;

  const isLocalhost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1";
  return isLocalhost(browserOrigin.hostname) && isLocalhost(serverOrigin.hostname);
};
