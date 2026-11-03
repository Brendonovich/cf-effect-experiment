/** Cloud's public base URL, which is also the MCP OAuth issuer. */
export const issuer = () =>
  (process.env.MCP_OAUTH_PUBLIC_ORIGIN || "https://macrograph.app/cloud").replace(/\/+$/, "");

/** An MCP server Cloud issues OAuth access tokens for. Each token works only for its resource. */
export interface Resource {
  readonly path: `/${string}`;
  readonly name: string;
  /** What allowing a client grants, shown on the consent page. */
  readonly consent: string;
}

export const projects: Resource = {
  path: "/api/mcp",
  name: "MacroGraph Cloud MCP",
  consent:
    "This lets the client use MacroGraph Cloud MCP as you, including reading and changing projects you can access.",
};

export const gateway: Resource = {
  path: "/api/gateway/mcp",
  name: "MacroGraph Gateway",
  consent:
    "This lets the client call your connected accounts, like Twitch and GitHub, through the MacroGraph gateway. Your tool policies decide which calls run immediately and which wait for your approval.",
};

export const resources: ReadonlyArray<Resource> = [projects, gateway];

export const resourceUrl = (resource: Resource) => `${issuer()}${resource.path}`;

export const resource = () => resourceUrl(projects);

export const resourceFor = (url: string | null) =>
  resources.find((resource) => resourceUrl(resource) === url);

/**
 * RFC 9728 inserts the well-known segment between the host and the resource path, so a resource
 * under `/cloud` publishes its metadata at `/.well-known/oauth-protected-resource/cloud/api/mcp`.
 */
export const protectedResourceMetadataUrl = (target: Resource = projects) => {
  const url = new URL(resourceUrl(target));
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
};

export const scope = "mcp";
