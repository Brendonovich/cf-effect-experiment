/** Cloud's public base URL, which is also the MCP OAuth issuer. */
export const issuer = () =>
  (process.env.MCP_OAUTH_PUBLIC_ORIGIN || "https://macrograph.app/cloud").replace(/\/+$/, "");

export const resource = () => `${issuer()}/api/mcp`;

/**
 * RFC 9728 inserts the well-known segment between the host and the resource path, so a resource
 * under `/cloud` publishes its metadata at `/.well-known/oauth-protected-resource/cloud/api/mcp`.
 */
export const protectedResourceMetadataUrl = () => {
  const url = new URL(resource());
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
};

export const scope = "mcp";
