export const logoutWebsite = async (
  fetchImplementation: typeof fetch = fetch,
): Promise<boolean> => {
  try {
    const response = await fetchImplementation("https://www.macrograph.app/api/cloud-logout", {
      method: "POST",
      credentials: "include",
      mode: "cors",
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    return response.status === 204;
  } catch {
    return false;
  }
};
