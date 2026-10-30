import { Button, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";

import { safeNextPath, sessionKey, submitCredentials } from "../api";
import { Redirect, useGoTo, useSession } from "../session";
import { showToast } from "../Toasts";

const copy = {
  login: {
    title: "Log in to MacroGraph",
    submit: "Log in",
    pending: "Logging in...",
    switchPrompt: "Don't have an account?",
    switchLabel: "Sign up",
    switchPath: "/signup",
    autocomplete: "current-password",
  },
  signup: {
    title: "Create your MacroGraph account",
    submit: "Create account",
    pending: "Creating account...",
    switchPrompt: "Already have an account?",
    switchLabel: "Log in",
    switchPath: "/login",
    autocomplete: "new-password",
  },
} as const;

export function AuthRoute(props: { readonly mode: "login" | "signup" }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const goTo = useGoTo();
  const location = useLocation();
  const next = () => safeNextPath(new URLSearchParams(location.search).get("next"));
  const text = () => copy[props.mode];

  const submit = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (form: FormData) => {
      const result = await submitCredentials(
        props.mode,
        String(form.get("email") ?? ""),
        String(form.get("password") ?? ""),
      );
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      showToast({
        tone: "success",
        content: props.mode === "login" ? "You are now logged in" : "Welcome to MacroGraph",
      });
      goTo(next());
    },
  }));

  return (
    <main sx={styles.page}>
      <Show
        // A successful submit already navigates; redirecting again would load the page twice.
        when={!session.data || submit.isPending || submit.isSuccess}
        fallback={<Redirect href={next()} />}
      >
        <div sx={styles.card}>
          <a href="/" aria-label="MacroGraph home" sx={styles.logoLink}>
            <img src={macrographLogo} alt="" sx={styles.logo} />
          </a>
          <h1 sx={styles.title}>{text().title}</h1>
          <form
            sx={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate(new FormData(event.currentTarget));
            }}
          >
            <fieldset sx={styles.fieldset} disabled={submit.isPending}>
              <label sx={styles.field}>
                <span sx={styles.label}>Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  autocomplete="email"
                  placeholder="you@example.com"
                  sx={styles.input}
                />
              </label>
              <label sx={styles.field}>
                <span sx={styles.label}>Password</span>
                <input
                  name="password"
                  type="password"
                  required
                  minlength={props.mode === "signup" ? 8 : undefined}
                  autocomplete={text().autocomplete}
                  sx={styles.input}
                />
              </label>
              <Show when={submit.error}>
                {(error) => (
                  <p role="alert" sx={styles.error}>
                    {error().message}
                  </p>
                )}
              </Show>
              <Button type="submit" sx={styles.submit}>
                {submit.isPending ? text().pending : text().submit}
              </Button>
            </fieldset>
          </form>
          <p sx={styles.switch}>
            {text().switchPrompt}{" "}
            <a href={`${text().switchPath}${location.search}`} sx={[styles.switchLink]}>
              {text().switchLabel}
            </a>
          </p>
        </div>
      </Show>
    </main>
  );
}

const styles = stylex.create({
  page: {
    display: "grid",
    minHeight: "100dvh",
    boxSizing: "border-box",
    placeItems: "center",
    padding: 24,
    backgroundColor: colors.gray1,
    color: colors.gray12,
  },
  card: { width: "100%", maxWidth: 360, textAlign: "center" },
  logoLink: { display: "inline-block" },
  logo: { width: 72, height: 72, borderRadius: 16 },
  title: { margin: 0, marginTop: 20, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" },
  form: { marginTop: 28 },
  fieldset: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    margin: 0,
    padding: 0,
    border: 0,
    textAlign: "left",
  },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: colors.gray11 },
  input: {
    height: 40,
    boxSizing: "border-box",
    paddingInline: 12,
    borderColor: { default: colors.gray5, ":focus": colors.gray8 },
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray2,
    fontSize: 14,
    color: colors.gray12,
    outline: "none",
    "::placeholder": { color: colors.gray8 },
  },
  error: {
    margin: 0,
    paddingBlock: 8,
    paddingInline: 10,
    borderColor: colors.red6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: colors.red3,
    fontSize: 13,
    color: colors.red11,
  },
  submit: { width: "100%", height: 40, marginTop: 4, borderRadius: 8, fontSize: 14 },
  switch: { margin: 0, marginTop: 24, fontSize: 13, color: colors.gray10 },
  switchLink: { color: colors.gray12, fontWeight: 500 },
});
