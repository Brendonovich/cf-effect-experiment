export const tryWebsiteLogin = async (
  verificationUrl: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<"approved" | "retry" | "unavailable"> => {
  try {
    const url = new URL(verificationUrl);
    const userCode = url.searchParams.get("userCode");
    if (
      (url.origin !== "https://www.macrograph.app" && url.origin !== "https://macrograph.app") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/server-registration" ||
      !userCode ||
      userCode.length > 10
    )
      return "unavailable";

    const response = await fetchImplementation("https://www.macrograph.app/api/cloud-login", {
      method: "POST",
      credentials: "include",
      mode: "cors",
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode }),
      signal: AbortSignal.timeout(5000),
    });
    return response.status === 204 ? "approved" : response.status === 409 ? "retry" : "unavailable";
  } catch {
    // Website sign-in is optional; keep the existing authorization flow available.
    return "unavailable";
  }
};
