/** The zone every public MacroGraph hostname lives in. */
export const zoneName = "macrograph.app";

/**
 * The hostname a stage is served from: WebsiteWorker owns it as a Custom Domain and CloudWorker
 * claims `/cloud` on it with Worker Routes, so both share one origin and one session cookie.
 * Other stages have none: WebsiteWorker forwards Cloud's paths on its own workers.dev URL instead,
 * because Worker Routes only run on zones we own.
 */
export const forStage = (stage: string): string | undefined =>
  stage === "production" ? zoneName : undefined;

/** Hosts that browsers are redirected from to the canonical host. API clients keep using them. */
export const legacyBrowserHosts: ReadonlySet<string> = new Set([`www.${zoneName}`]);
