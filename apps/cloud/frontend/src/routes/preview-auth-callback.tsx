import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { Show, createSignal, onSettled } from "solid-js";

import { runApi } from "../api";
import { useAuth } from "../Auth";
import { takePreviewAuthenticationAttempt } from "../previewAuth";

export const PreviewAuthCallbackRoute = () => {
  const auth = useAuth();
  const [error, setError] = createSignal(false);

  onSettled(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    history.replaceState(null, "", `${location.pathname}${location.hash}`);
    const attempt = state === null ? undefined : takePreviewAuthenticationAttempt(state);
    if (code === null || attempt === undefined) {
      setError(true);
      return;
    }
    void runApi(
      auth.api.previewAuth.exchange({
        payload: {
          code,
          codeVerifier: attempt.verifier,
          redirectUri: attempt.redirectUri,
        },
      }),
    ).then((result) => {
      if (result === undefined) {
        setError(true);
        return;
      }
      const baseRoot = `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/`;
      const next =
        attempt.next !== baseRoot
          ? attempt.next
          : `/teams/${result.teamId}/projects/${result.projectId}/editor`;
      location.replace(next);
    });
  });

  return (
    <main sx={styles.root}>
      <Show
        when={error()}
        fallback={<LoadingState label="Signing in to the preview" style={styles.loading} />}
      >
        <div>
          <h1 sx={styles.title}>Could not sign in to this preview</h1>
          <p sx={styles.message}>Return to the sign-in page and try again.</p>
          <a href={`${import.meta.env.BASE_URL}sign-in`} sx={styles.link}>
            Try again
          </a>
        </div>
      </Show>
    </main>
  );
};

const styles = stylex.create({
  root: {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    backgroundColor: colors.gray1,
    color: colors.gray12,
    textAlign: "center",
  },
  loading: { width: 320, height: 120 },
  title: { margin: 0, fontSize: 20 },
  message: { marginTop: 8, color: colors.gray10 },
  link: { display: "inline-block", marginTop: 16, color: colors.gray12 },
});
