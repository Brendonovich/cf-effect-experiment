export const issuer = () =>
  (process.env.MCP_OAUTH_PUBLIC_ORIGIN || "https://cloud.macrograph.app").replace(/\/+$/, "");

export const resource = () => `${issuer()}/api/mcp`;

export const protectedResourceMetadataUrl = () =>
  `${issuer()}/.well-known/oauth-protected-resource/api/mcp`;

export const scope = "mcp";
