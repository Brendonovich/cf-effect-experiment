import { LoadingState, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Loading, Show } from "solid-js";

import { useAuth } from "../Auth";
import { signInReturnPath } from "../authRedirect";
import { Redirect } from "../Redirect";

export function SignInRoute() {
  const auth = useAuth();
  const location = useLocation();
  const logoutFailed = () => new URLSearchParams(location.search).get("logout") === "failed";
  const verificationUrl = () => {
    const status = auth.status();
    return status.state === "pending" ? status.verificationUrl : undefined;
  };

  return (
    <main sx={styles.root}>
      <div sx={styles.content}>
        <img src={macrographLogo} alt="MacroGraph" sx={styles.logo} />
        <Show
          when={!logoutFailed()}
          fallback={
            <>
              <h1 sx={styles.title}>Could not finish signing out</h1>
              <p sx={styles.description}>
                Your session could still be active on MacroGraph or Cloud. Please try again.
              </p>
              <button type="button" sx={styles.button} onClick={() => void auth.signOut()}>
                Try signing out again
              </button>
            </>
          }
        >
          <Loading fallback={<LoadingState label="Checking your session" />}>
            <Show
              when={auth.status().state !== "connected"}
              fallback={
                <Redirect
                  href={signInReturnPath(
                    new URLSearchParams(location.search).get("next"),
                    import.meta.env.BASE_URL,
                  )}
                  replace
                  resolve={false}
                />
              }
            >
              <Show
                when={auth.status().state !== "failed"}
                fallback={
                  <>
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
                <h1 sx={styles.title}>Connect to MacroGraph Cloud</h1>
                <p sx={styles.description}>
                  Sign in in a new tab, then return here. Keep this tab open while MacroGraph
                  completes the connection.
                </p>
                <a
                  href={verificationUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={verificationUrl() === undefined ? "true" : "false"}
                  onClick={(event) => {
                    if (verificationUrl() === undefined) event.preventDefault();
                  }}
                  sx={styles.button}
                >
                  Continue to sign in
                </a>
                <div sx={styles.waiting}>
                  <span sx={styles.waitingDot} />
                  Waiting for authorization
                </div>
              </Show>
            </Show>
          </Loading>
        </Show>
      </div>
    </main>
  );
}

const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });
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
  waiting: {
    marginTop: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 12,
    color: colors.gray9,
  },
  waitingDot: {
    width: 6,
    height: 6,
    borderRadius: 9999,
    backgroundColor: "#60a5fa",
    animation: `${pulse} 2s infinite`,
  },
});
