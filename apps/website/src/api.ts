import type { Credential } from "@macrograph/module";

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
  readonly user: { readonly id: string; readonly email: string };
  readonly session: { readonly id: string };
}

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

export async function websiteRequest<T>(
  path: string,
  init?: { readonly method?: string; readonly body?: unknown },
): Promise<T> {
  const response = await fetch(`/api/website${path}`, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
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

export const getSession = () => websiteRequest<Session | null>("/session");
export const getCredentials = () =>
  websiteRequest<ReadonlyArray<WebsiteCredential>>("/credentials");
export const getAuthorizations = () =>
  websiteRequest<ReadonlyArray<Authorization>>("/authorizations");

export const submitCredentials = (mode: "login" | "signup", email: string, password: string) =>
  websiteRequest<AuthResult>(`/${mode}`, { method: "POST", body: { email, password } });

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
