import { LoadingState } from "@macrograph/editor-ui";
import { Loading, Show } from "solid-js";

import { useAuth } from "../Auth";
import { signInUrl } from "../authRedirect";
import { Redirect } from "../Redirect";

const Authorize = () => {
  const authorize = new URL("/api/preview-auth/authorize", location.origin);
  authorize.search = location.search;
  location.replace(authorize);
  return null;
};

export const PreviewAuthAuthorizeRoute = () => {
  const auth = useAuth();
  return (
    <Loading fallback={<LoadingState label="Checking your production session" />}>
      <Show
        when={auth.status().state === "connected"}
        fallback={
          <Redirect
            href={signInUrl(`${location.pathname}${location.search}`, import.meta.env.BASE_URL)}
            replace
            resolve={false}
          />
        }
      >
        <Authorize />
      </Show>
    </Loading>
  );
};
