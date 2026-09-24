const credentialProxyPath = "/__macrograph_credentials";

interface PreviewWorkerEnv {
  readonly ASSETS: {
    readonly fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  fetch(request: Request, env: PreviewWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname === credentialProxyPath ||
      url.pathname.startsWith(`${credentialProxyPath}/`)
    ) {
      url.protocol = "https:";
      url.host = "www.macrograph.app";
      url.pathname = `/api${url.pathname.slice(credentialProxyPath.length)}`;
      return fetch(new Request(url, request));
    }

    return env.ASSETS.fetch(request);
  },
};
