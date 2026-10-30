/** MacroGraph accounts sign in on the website, which shares Cloud's origin. */
export const signInUrl = (destination: string) => `/login?next=${encodeURIComponent(destination)}`;

/** Paths served by the worker rather than the frontend router, which require a full navigation. */
export const isWorkerRoute = (path: string, basePath = "/") =>
  new RegExp(`^${basePath.replace(/\/+$/, "")}/oauth(/|$|\\?)`, "i").test(path);

export const signInReturnPath = (next: string | null, basePath = "/") => {
  const base = basePath.replace(/\/+$/, "");
  const fallback = `${base}/`;
  if (!next?.startsWith("/")) return fallback;
  try {
    // Any origin works for parsing; only same-origin paths under Cloud's mount are accepted.
    const origin = "https://macrograph.invalid";
    const url = new URL(next, origin);
    const pathname = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, "");
    if (
      url.origin !== origin ||
      pathname === `${base}/sign-in`.toLowerCase() ||
      (url.pathname !== base && !url.pathname.startsWith(`${base}/`))
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
};
