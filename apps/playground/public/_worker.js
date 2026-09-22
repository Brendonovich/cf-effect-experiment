const credentialProxyPath = "/__macrograph_credentials";

export default {
  fetch(request, env) {
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
