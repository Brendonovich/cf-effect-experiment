import { LoadingState, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Loading, Show } from "solid-js";

import { useAuth } from "../Auth";
import { isWorkerRoute, signInReturnPath, signInUrl } from "../authRedirect";
import { Redirect } from "../Redirect";

/**
 * Sends visitors to the website's login and back. Signed-in visitors continue to their
 * destination; a failed sign-out stays here so it can be retried.
 */
export function SignInRoute() {
  const auth = useAuth();
  const location = useLocation();
  const returnPath = () =>
    signInReturnPath(new URLSearchParams(location.search).get("next"), import.meta.env.BASE_URL);
  const logoutFailed = () => new URLSearchParams(location.search).get("logout") === "failed";

  return (
    <main sx={styles.root}>
      <div sx={styles.content}>
        <Show
          when={!logoutFailed()}
          fallback={
            <>
              <img src={macrographLogo} alt="MacroGraph" sx={styles.logo} />
              <h1 sx={styles.title}>Could not finish signing out</h1>
              <p sx={styles.description}>
                Your MacroGraph session could still be active. Please try again.
              </p>
              <button type="button" sx={styles.button} onClick={() => void auth.signOut()}>
                Try signing out again
              </button>
            </>
          }
        >
          <Loading fallback={<LoadingState label="Checking your session" />}>
            <Show
              when={auth.status().state !== "failed"}
              fallback={
                <>
                  <img src={macrographLogo} alt="MacroGraph" sx={styles.logo} />
                  <h1 sx={styles.title}>Failed to connect to MacroGraph Cloud</h1>
                  <p sx={styles.description}>
                    MacroGraph could not reach the cloud service. Check your connection and try
                    again.
                  </p>
                  <button type="button" sx={styles.button} onClick={auth.retry}>
                    Try again
                  </button>
                </>
              }
            >
              <Redirect
                href={auth.status().state === "connected" ? returnPath() : signInUrl(returnPath())}
                replace
                resolve={false}
                document={
                  auth.status().state !== "connected" ||
                  isWorkerRoute(returnPath(), import.meta.env.BASE_URL)
                }
              />
            </Show>
          </Loading>
        </Show>
      </div>
    </main>
  );
}

const styles = stylex.create({
  root: {
    display: "grid",
    minHeight: "100dvh",
    placeItems: "center",
    backgroundColor: colors.gray1,
    color: colors.gray12,
    padding: 24,
    colorScheme: "dark",
  },
  content: { width: "100%", maxWidth: 384, textAlign: "center" },
  logo: { marginInline: "auto", marginBottom: 28, width: 96, height: 96, borderRadius: 16 },
  title: { fontSize: 20, fontWeight: 600, letterSpacing: "-.025em" },
  description: { marginTop: 8, fontSize: 14, lineHeight: "24px", color: colors.gray10 },
  button: {
    marginTop: 24,
    display: "inline-flex",
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11 },
    paddingInline: 20,
    fontSize: 14,
    fontWeight: 600,
    color: colors.gray1,
    transition: "150ms",
  },
});
