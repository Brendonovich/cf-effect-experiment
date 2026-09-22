import type { SessionStatus } from "@macrograph/cloud-api";
import type { JSX } from "@solidjs/web";

import { Effect } from "effect";
import { createContext, createMemo, refresh, useContext } from "solid-js";

import { type ApiClient, makeApiClient, publicWorkerOrigin, runApiResult } from "./api";
import { cloudLogin } from "./cloudLogin";
import { logoutWebsite } from "./websiteLogout";

interface AuthContextValue {
  readonly api: ApiClient;
  readonly status: () => SessionStatus | { state: "failed" };
  readonly retry: () => void;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>();
export const useAuth = () => useContext(AuthContext);

export function AuthProvider(props: { readonly children: JSX.Element }) {
  let signingOut = false;
  const api = makeApiClient(publicWorkerOrigin(), () => signingOut);
  const status = createMemo<SessionStatus | { state: "failed" }>(() =>
    cloudLogin(
      api.session,
      location.origin === "https://cloud.macrograph.app" &&
        new URLSearchParams(location.search).get("logout") !== "failed",
    ),
  );

  const signOut = async () => {
    signingOut = true;
    const [cloudSignedOut, websiteSignedOut] = await Promise.all([
      runApiResult(api.session.disconnect().pipe(Effect.timeout("5 seconds"))),
      location.origin === "https://cloud.macrograph.app" ? logoutWebsite() : Promise.resolve(true),
    ]);
    window.location.assign(
      `${import.meta.env.BASE_URL}sign-in${cloudSignedOut && websiteSignedOut ? "" : "?logout=failed"}`,
    );
  };

  return (
    <AuthContext value={{ api, status, retry: () => refresh(status), signOut }}>
      {props.children}
    </AuthContext>
  );
}
