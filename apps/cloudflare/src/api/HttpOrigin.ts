interface OriginRequest {
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
