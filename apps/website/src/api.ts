import type { Credential } from "@macrograph/module";

import { getRequestEvent, isServer } from "@solidjs/web";

export type AuthProvider = "twitch" | "discord" | "spotify" | "patreon" | "github";

export const providerDisplayNames: Record<AuthProvider, string> = {
  twitch: "Twitch",
  discord: "Discord",
  spotify: "Spotify",
  patreon: "Patreon",
  github: "GitHub",
};

/** Providers offered for new credentials. The others remain listed when already connected. */
export const connectableProviders: ReadonlyArray<AuthProvider> = ["twitch", "discord"];

export interface Session {
  readonly user: {
    readonly id: string;
    readonly email: string;
    /** Password-only accounts must connect a sign-in provider before using anything else. */
    readonly hasSignInMethod: boolean;
  };
  readonly session: { readonly id: string };
}

/** A provider people can sign in to MacroGraph with. */
export interface SignInProvider {
  readonly id: string;
  readonly displayName: string;
}

/** A provider account connected for signing in. */
export interface SignInMethod {
  readonly providerId: string;
  readonly providerUserId: string;
  readonly displayName: string | null;
  readonly email: string | null;
}

/** Messages for the `?error=` a failed provider sign-in returns with. */
const signInErrors: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "Sign-in took too long or was started in another browser. Please try again.",
  failed: "The provider couldn't be reached. Please try again.",
  email_unverified:
    "That account has no verified email address. Verify one with the provider, or use another provider.",
  account_exists:
    "A MacroGraph account already uses that email. Log in with your email and password, then connect this provider.",
  identity_in_use: "That provider account already signs in to a different MacroGraph account.",
};

export const signInErrorMessage = (error: string | null) =>
  error === null ? undefined : (signInErrors[error] ?? signInErrors.failed);

/** Starts signing in with a provider, which returns to `returnTo`. Signed in, this connects it. */
export const signInUrl = (provider: string, returnTo: string) =>
  `/api/website/sign-in/${encodeURIComponent(provider)}?${new URLSearchParams({ returnTo })}`;

/** The current page without the `error` a failed sign-in added. */
export const withoutSignInError = (pathname: string, search: string) => {
  const params = new URLSearchParams(search);
  params.delete("error");
  const query = params.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
};

export interface WebsiteCredential {
  readonly providerId: string;
  readonly providerUserId: string;
  readonly displayName: string | null;
}

export type OAuthScope = "openid" | "email" | "offline_access" | "credentials";

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  /** Built-in MacroGraph apps; other names are chosen by whoever runs the server. */
  readonly verified: boolean;
}

/** A device sign-in waiting for approval on `/device`. */
export interface DeviceRequest {
  readonly userCode: string;
  readonly client: OAuthClient;
  readonly scope: ReadonlyArray<OAuthScope>;
  readonly requestedAt: number;
  readonly expiresAt: number;
  readonly requestIp: string | null;
  readonly requestCountry: string | null;
}

/** An app the user allowed to use their credentials. */
export interface Authorization {
  readonly id: string;
  readonly client: OAuthClient;
  readonly scope: ReadonlyArray<OAuthScope>;
  readonly createdAt: number;
  readonly lastUsedAt: number;
}

export type AuthResult =
  | { readonly success: true; readonly userId: string }
  | { readonly success: false; readonly error: string };

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Request failed with status ${status}`);
  }
}

/** The website's Worker bindings, which the server render receives (see `worker.ts`). */
export interface WorkerBindings {
  /** WebsiteWorker: the account API. */
  readonly API?: { readonly fetch: (request: Request) => Promise<Response> };
  /** CloudWorker, for stages without Worker Routes. */
  readonly CLOUD?: { readonly fetch: (request: Request) => Promise<Response> };
  /** Set on pull request previews, which only let allowed accounts in. */
  readonly PREVIEW_GATE?: string;
}

/** Where the server render reaches the API when it runs outside the Worker (`vite` dev). */
const devApiOrigin = () =>
  (typeof process === "undefined" ? undefined : process.env.VITE_WEBSITE_WORKER_URL) ??
  "http://localhost:1339";

/**
 * Calls the website API. In the browser it's a same-origin fetch; during the server render it goes
 * to WebsiteWorker over its service binding, as the visitor, and passes any refreshed session
 * cookie on to the page response.
 */
async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  if (!isServer) return fetch(path, { ...init, credentials: "same-origin" });
  const event = getRequestEvent();
  const incoming = event?.request;
  const url = new URL(path, incoming?.url ?? "http://localhost");
  const headers = new Headers(init.headers);
  const cookie = incoming?.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  // Writes require a same-origin request, which this is on the visitor's behalf. A request built
  // here has no Host header, so the API learns the origin it compares against from these.
  headers.set("origin", url.origin);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
  const native = (event as { readonly nativeEvent?: { readonly env?: WorkerBindings } } | undefined)
    ?.nativeEvent;
  const api = native?.env?.API;
  const response = api
    ? await api.fetch(new Request(url, { ...init, headers }))
    : await fetch(new URL(`${url.pathname}${url.search}`, devApiOrigin()), { ...init, headers });
  const head = (event as { readonly response?: { readonly headers?: Headers } } | undefined)
    ?.response?.headers;
  for (const value of response.headers.getSetCookie()) head?.append("set-cookie", value);
  return response;
}

export async function websiteRequest<T>(
  path: string,
  init?: { readonly method?: string; readonly body?: unknown },
): Promise<T> {
  const response = await apiFetch(`/api/website${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const sessionKey = ["session"] as const;
export const credentialsKey = ["credentials"] as const;
export const authorizationsKey = ["authorizations"] as const;
export const signInProvidersKey = ["signInProviders"] as const;
export const signInMethodsKey = ["signInMethods"] as const;

export const getSession = () => websiteRequest<Session | null>("/session");
export const getSignInProviders = () =>
  websiteRequest<ReadonlyArray<SignInProvider>>("/sign-in/providers");
export const getSignInMethods = () =>
  websiteRequest<ReadonlyArray<SignInMethod>>("/sign-in-methods");
export const removeSignInMethod = (method: SignInMethod) =>
  websiteRequest<void>(
    `/sign-in-methods/${encodeURIComponent(method.providerId)}/${encodeURIComponent(method.providerUserId)}`,
    { method: "DELETE" },
  );
export const getCredentials = () =>
  websiteRequest<ReadonlyArray<WebsiteCredential>>("/credentials");
export const getAuthorizations = () =>
  websiteRequest<ReadonlyArray<Authorization>>("/authorizations");

/** Only accounts from before sign-in providers have a password. */
export const logInWithPassword = (email: string, password: string) =>
  websiteRequest<AuthResult>("/login", { method: "POST", body: { email, password } });

export const logOut = () => websiteRequest<void>("/logout", { method: "POST" });

export const removeCredential = (credential: { readonly provider: string; readonly id: string }) =>
  websiteRequest<void>(
    `/credentials/${encodeURIComponent(credential.provider)}/${encodeURIComponent(credential.id)}`,
    { method: "DELETE" },
  );

export const revokeAuthorization = (id: string) =>
  websiteRequest<void>(`/authorizations/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Resolves to `null` when the code is unknown, used, or expired. */
export const lookupDeviceRequest = async (userCode: string) => {
  try {
    return await websiteRequest<DeviceRequest>("/device/lookup", {
      method: "POST",
      body: { userCode },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
};

export const decideDeviceRequest = (userCode: string, decision: "approve" | "deny") =>
  websiteRequest<boolean>(`/device/${decision}`, { method: "POST", body: { userCode } });

export class PopupBlockedError extends Error {
  constructor() {
    super("Your browser blocked the login window. Allow popups for this site and try again.");
  }
}

export class ConnectionCancelledError extends Error {
  constructor() {
    super("The login window was closed before the credential was connected.");
  }
}

/**
 * Connects a provider account. The authorization window posts its callback query string back to
 * this page, which the website API exchanges for the credential.
 */
export async function connectCredential(provider: string) {
  // Open synchronously so the click's user activation is not lost to the request below.
  const popup = window.open("about:blank", "macrograph-credential", "popup,width=720,height=760");
  if (popup === null) throw new PopupBlockedError();
  try {
    const { url } = await websiteRequest<{ url: string }>(
      `/credentials/${encodeURIComponent(provider)}/authorize`,
    );
    popup.location.replace(url);
    const search = await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        window.removeEventListener("message", receive);
        window.clearInterval(closed);
      };
      const receive = (event: MessageEvent) => {
        if (event.source !== popup || event.origin !== location.origin) return;
        if (typeof event.data !== "string" || !event.data.startsWith("?")) return;
        cleanup();
        resolve(event.data);
      };
      const closed = window.setInterval(() => {
        if (!popup.closed) return;
        cleanup();
        reject(new ConnectionCancelledError());
      }, 500);
      window.addEventListener("message", receive);
    });
    return await websiteRequest<{ user: { id: string; displayName: string } }>(
      `/credentials/${encodeURIComponent(provider)}`,
      { method: "POST", body: { search } },
    );
  } catch (cause) {
    popup.close();
    throw cause;
  }
}

export const toCredentialSummary = (credential: WebsiteCredential): Credential.Summary => ({
  provider: credential.providerId,
  id: credential.providerUserId,
  displayName: credential.displayName,
  status: "available",
  scopes: [],
  metadata: {},
});

/** A same-site path to return to after signing in, or `/` for anything else. */
export const safeNextPath = (next: string | null | undefined) =>
  next !== null &&
  next !== undefined &&
  next.startsWith("/") &&
  !next.startsWith("//") &&
  !next.startsWith("/\\")
    ? next
    : "/";

export const loginPath = (next: string) => `/login?next=${encodeURIComponent(next)}`;

/** Whether a same-site path belongs to another app on this origin, such as Cloud at `/cloud`. */
export const isExternalPath = (path: string) => /^\/(cloud|api|auth)(\/|$|\?|#)/.test(path);
