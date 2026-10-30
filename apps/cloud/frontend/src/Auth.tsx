import type { SessionStatus } from "@macrograph/cloud-api";
import type { JSX } from "@solidjs/web";

import { Effect } from "effect";
import { createContext, createMemo, refresh, useContext } from "solid-js";

import { type ApiClient, makeApiClient, publicWorkerOrigin, runApi } from "./api";

interface AuthContextValue {
  readonly api: ApiClient;
  readonly status: () => SessionStatus | { state: "failed" };
  readonly retry: () => void;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>();
export const useAuth = () => useContext(AuthContext);

/** Ends the shared MacroGraph session, which signs out of the website and Cloud together. */
const logOut = async () => {
  try {
    const response = await fetch("/api/website/logout", {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export function AuthProvider(props: { readonly children: JSX.Element }) {
  let signingOut = false;
  const api = makeApiClient(publicWorkerOrigin(), () => signingOut);
  const status = createMemo<SessionStatus | { state: "failed" }>(async () => {
    const result = await runApi(api.session.get().pipe(Effect.timeout("15 seconds")));
    return result ?? { state: "failed" };
  });

  const signOut = async () => {
    signingOut = true;
    if (await logOut()) window.location.assign("/");
    else window.location.assign(`${import.meta.env.BASE_URL}sign-in?logout=failed`);
  };

  return (
    <AuthContext value={{ api, status, retry: () => refresh(status), signOut }}>
      {props.children}
    </AuthContext>
  );
}
