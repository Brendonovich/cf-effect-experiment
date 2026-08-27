export const signInUrl = (destination: string, basePath = "/") =>
  `${basePath.replace(/\/+$/, "")}/sign-in?next=${encodeURIComponent(destination)}`;

export const signInReturnPath = (next: string | null, basePath = "/") => {
  const base = basePath.replace(/\/+$/, "");
  const fallback = `${base}/`;
  if (!next?.startsWith("/")) return fallback;
  try {
    const url = new URL(next, "https://cloud.macrograph.app");
    const pathname = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, "");
    if (
      url.origin !== "https://cloud.macrograph.app" ||
      pathname === `${base}/sign-in`.toLowerCase() ||
      (url.pathname !== base && !url.pathname.startsWith(`${base}/`))
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
};
