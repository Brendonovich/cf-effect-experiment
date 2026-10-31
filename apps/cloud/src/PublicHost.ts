/** The zone every public MacroGraph hostname lives in. */
export const zoneName = "macrograph.app";

/**
 * The hostname a stage is served from. The website's Worker (`apps/website`) owns it as a Custom
 * Domain, while WebsiteWorker (the API), CloudWorker, and the playground claim their paths on it
 * with Worker Routes, so they all share one origin and one session cookie. Other stages have none:
 * the website's Worker forwards those paths over service bindings on its workers.dev URL, because
 * Worker Routes only run on zones we own.
 */
export const forStage = (stage: string): string | undefined =>
  stage === "production" ? zoneName : undefined;

/** Hosts that browsers are redirected from to the canonical host. API clients keep using them. */
export const legacyBrowserHosts: ReadonlySet<string> = new Set([`www.${zoneName}`]);

/** Pull request stages, deployed by CI as `pr<number>`. */
export const isPreviewStage = (stage: string) => /^pr\d+$/.test(stage);

/** The host every OAuth provider has registered `/auth/proxy` on; WebsiteWorker owns all of it. */
export const authRedirectHost = "macrograph.brendonovich.dev";

/** Where the playground (`apps/playground`) is mounted; its Vite `base` must match. */
export const playgroundPathPrefix = "/playground";

/** The Worker Route patterns the playground claims on a hostname. */
export const playgroundRoutePatterns = (hostname: string) => [
  `${hostname}${playgroundPathPrefix}`,
  `${hostname}${playgroundPathPrefix}/*`,
];

/**
 * The Worker Route patterns WebsiteWorker claims on a hostname. `/auth/*` stays for shipped desktop
 * apps, and RFC 8414 fixes the metadata document at the root of the issuer's host.
 */
export const apiRoutePatterns = (hostname: string) => [
  `${hostname}/api/*`,
  `${hostname}/auth/*`,
  `${hostname}/.well-known/oauth-authorization-server`,
];
