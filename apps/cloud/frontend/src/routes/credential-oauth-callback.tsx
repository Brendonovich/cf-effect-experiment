import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { Show, createSignal, onSettled } from "solid-js";

import { runApi } from "../api";
import { useAuth } from "../Auth";

export const providerFromState = (state: string) => {
  try {
    const payload = state.split(".")[0];
    if (payload === undefined) return undefined;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return typeof decoded.provider === "string" ? decoded.provider : undefined;
  } catch {
    return undefined;
  }
};

export const CredentialOAuthCallbackRoute = () => {
  const auth = useAuth();
  const [error, setError] = createSignal(false);

  onSettled(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    const provider = state === null ? undefined : providerFromState(state);
    const storedProvider = sessionStorage.getItem("macrograph-credential-provider");
    if (code === null || state === null || (storedProvider ?? provider) === null) {
      setError(true);
      return;
    }
    void runApi(
      auth.api.credentials.complete({
        payload: { provider: storedProvider ?? provider ?? "", code, state },
      }),
    ).then((result) => {
      if (result === undefined) {
        setError(true);
        return;
      }
      window.opener?.postMessage({ type: "macrograph-credential-connected" }, location.origin);
      window.close();
    });
  });

  return (
    <main sx={styles.root}>
      <Show
        when={error()}
        fallback={<LoadingState label="Finishing credential connection" style={styles.loading} />}
      >
        <div>
          <h1 sx={styles.title}>Could not connect credential</h1>
          <p sx={styles.message}>Close this window and try again from project settings.</p>
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
});
