/** The zone every public MacroGraph hostname lives in. */
export const zoneName = "macrograph.app";

/**
 * The hostname a stage is served from: WebsiteWorker owns it as a Custom Domain and CloudWorker
 * claims `/cloud` on it with Worker Routes, so both share one origin and one session cookie.
 * Previews get their own subdomain; local development has none and uses the Vite proxies.
 */
export const forStage = (stage: string): string | undefined =>
  stage === "production" ? zoneName : /^pr\d+$/.test(stage) ? `${stage}.${zoneName}` : undefined;

/** Hosts that browsers are redirected from to the canonical host. API clients keep using them. */
export const legacyBrowserHosts: ReadonlySet<string> = new Set([`www.${zoneName}`]);
