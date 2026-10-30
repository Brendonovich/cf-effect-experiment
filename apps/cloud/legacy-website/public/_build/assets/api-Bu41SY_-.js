import { b as action, q as query, e as cache } from "./action-EmZbM2bN.js";
function redirect(url, init = 302) {
  let responseInit;
  let revalidate;
  if (typeof init === "number") {
    responseInit = {
      status: init
    };
  } else {
    ({
      revalidate,
      ...responseInit
    } = init);
    if (typeof responseInit.status === "undefined") {
      responseInit.status = 302;
    }
  }
  const headers = new Headers(responseInit.headers);
  headers.set("Location", url);
  revalidate !== void 0 && headers.set("X-Revalidate", revalidate.toString());
  const response = new Response(null, {
    ...responseInit,
    headers
  });
  return response;
}
function reload(init = {}) {
  const {
    revalidate,
    ...responseInit
  } = init;
  const headers = new Headers(responseInit.headers);
  revalidate !== void 0 && headers.set("X-Revalidate", revalidate.toString());
  return new Response(null, {
    ...responseInit,
    headers
  });
}
class ApiError extends Error {
  constructor(status) {
    super(`Request failed with status ${status}`);
    this.status = status;
  }
}
async function websiteRequest(path, init) {
  const response = await fetch(`/api/website${path}`, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
    headers: init?.body === void 0 ? void 0 : {
      "content-type": "application/json"
    },
    body: init?.body === void 0 ? void 0 : JSON.stringify(init.body)
  });
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return void 0;
  return await response.json();
}
function loginRedirect() {
  const next = `${location.pathname}${location.search}`;
  return redirect(`/login?next=${encodeURIComponent(next)}`);
}
const getAuthState = query(() => websiteRequest("/session"), "getAuthState");
async function ensureAuthedOrRedirect() {
  const state = await getAuthState();
  if (state) return state;
  throw loginRedirect();
}
const getUser = cache(async () => {
  const state = await getAuthState();
  return state?.user ?? null;
}, "user");
const PROVIDER_DISPLAY_NAMES = {
  twitch: "Twitch",
  discord: "Discord",
  spotify: "Spotify",
  patreon: "Patreon",
  github: "GitHub"
};
const WINDOW_OPEN_FAILED = "window-open-failed";
const addCredential = action(async (provider) => {
  const {
    url
  } = await websiteRequest(`/credentials/${encodeURIComponent(provider)}/authorize`);
  const w = window.open(url, "_blank");
  if (!w) {
    throw new Error(WINDOW_OPEN_FAILED);
  }
  const searchParams = await new Promise((res) => {
    window.addEventListener("message", (e) => {
      if (e.source !== w) return;
      if (typeof e.data !== "string" || !e.data.startsWith("?")) return;
      res(e.data);
    });
  });
  return await websiteRequest(`/credentials/${encodeURIComponent(provider)}`, {
    method: "POST",
    body: {
      search: searchParams
    }
  });
});
const removeCredential = action(async (provider, providerUserId) => {
  await websiteRequest(`/credentials/${encodeURIComponent(provider)}/${encodeURIComponent(providerUserId)}`, {
    method: "DELETE"
  });
});
const getCredentials = query(async () => {
  await ensureAuthedOrRedirect();
  return await websiteRequest("/credentials");
}, "credentials");
const getServers = query(async () => {
  await ensureAuthedOrRedirect();
  return await websiteRequest("/servers");
}, "servers");
const savePlaygroundProject = action(async (project) => {
  const {
    id
  } = await websiteRequest("/playground", {
    method: "POST",
    body: {
      project
    }
  });
  return id;
});
const fetchPlaygroundProject = cache((id) => websiteRequest(`/playground/${encodeURIComponent(id)}`), "fetchPlaygroundProject");
export {
  PROVIDER_DISPLAY_NAMES as P,
  WINDOW_OPEN_FAILED as W,
  getUser as a,
  getCredentials as b,
  addCredential as c,
  removeCredential as d,
  ensureAuthedOrRedirect as e,
  fetchPlaygroundProject as f,
  getAuthState as g,
  getServers as h,
  reload as r,
  savePlaygroundProject as s,
  websiteRequest as w
};
