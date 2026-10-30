import type { JSX } from "@solidjs/web";

import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { Show, untrack } from "solid-js";

import { type Session, getSession, isExternalPath, logOut, loginPath, sessionKey } from "./api";
import { showToast } from "./Toasts";

export const useSession = () =>
  createQuery(() => ({ queryKey: sessionKey, queryFn: getSession, staleTime: 60_000 }));

export function useLogOut() {
  const queryClient = useQueryClient();
  return useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: logOut,
    onSuccess: () => {
      queryClient.setQueryData(sessionKey, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionKey[0] });
      showToast({ tone: "success", content: "Logged out" });
    },
    onError: () => showToast({ tone: "error", content: "Could not log out. Please try again." }),
  }));
}

/** Navigates within the website, or loads the page when the path belongs to another app. */
export function useGoTo() {
  const navigate = useNavigate();
  return (href: string) => {
    if (isExternalPath(href)) window.location.replace(href);
    else navigate(href, { replace: true });
  };
}

export function Redirect(props: { readonly href: string }) {
  const goTo = useGoTo();
  goTo(untrack(() => props.href));
  return null;
}

/** Renders its children for signed-in users and sends everyone else to the login page. */
export function RequireSession(props: { readonly children: (session: Session) => JSX.Element }) {
  const session = useSession();
  const location = useLocation();
  return (
    <Show
      when={!session.isPending}
      fallback={<LoadingState label="Checking your session" style={styles.loading} />}
    >
      <Show
        when={session.data}
        keyed
        fallback={<Redirect href={loginPath(`${location.pathname}${location.search}`)} />}
      >
        {(value) => props.children(value)}
      </Show>
    </Show>
  );
}

const styles = stylex.create({
  loading: { minHeight: 240, color: colors.gray10 },
});
