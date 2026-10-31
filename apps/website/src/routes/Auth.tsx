import { Button, ButtonLink, LoadingState, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { For, Match, Show, Switch, createSignal } from "solid-js";

import {
  getSignInProviders,
  logInWithPassword,
  safeNextPath,
  sessionKey,
  signInErrorMessage,
  signInProvidersKey,
  signInUrl,
  withoutSignInError,
} from "../api";
import { Redirect, useLogOut, useSession } from "../session";

/** Each provider's mark in its brand colors, as they show on a dark background. */
export function ProviderIcon(props: { readonly provider: string }) {
  return (
    <Switch fallback={<IconTablerKey {...stylex.attrs(styles.providerIcon)} />}>
      <Match when={props.provider === "twitch"}>
        <IconSimpleIconsTwitch {...stylex.attrs(styles.providerIcon, styles.twitch)} />
      </Match>
      <Match when={props.provider === "github"}>
        <IconSimpleIconsGithub {...stylex.attrs(styles.providerIcon, styles.github)} />
      </Match>
      <Match when={props.provider === "google"}>
        <IconLogosGoogleIcon {...stylex.attrs(styles.providerIcon)} />
      </Match>
      <Match when={props.provider === "discord"}>
        <IconSimpleIconsDiscord {...stylex.attrs(styles.providerIcon, styles.discord)} />
      </Match>
    </Switch>
  );
}

/**
 * Links that sign in with each provider, or connect it when signed in. The provider returns to
 * `returnTo`, with `?error=` when it fails.
 */
export function SignInProviderButtons(props: {
  readonly returnTo: string;
  readonly label: (provider: string) => string;
}) {
  const providers = createQuery(() => ({
    queryKey: signInProvidersKey,
    queryFn: getSignInProviders,
    staleTime: Infinity,
  }));
  return (
    <Show
      when={!providers.isPending}
      fallback={<LoadingState label="Loading sign-in options" style={styles.providersLoading} />}
    >
      <div sx={styles.providers}>
        <For each={providers.data ?? []}>
          {(provider) => (
            <ButtonLink
              // The API, not the website router, handles this path.
              rel="external"
              href={signInUrl(provider.id, props.returnTo)}
              variant="secondary"
              sx={styles.provider}
            >
              <ProviderIcon provider={provider.id} />
              {props.label(provider.displayName)}
            </ButtonLink>
          )}
        </For>
      </div>
    </Show>
  );
}

export function SignInError(props: { readonly inCard?: boolean }) {
  const location = useLocation();
  return (
    <Show when={signInErrorMessage(new URLSearchParams(location.search).get("error"))}>
      {(message) => (
        <p role="alert" sx={[styles.error, props.inCard && styles.cardError]}>
          {message()}
        </p>
      )}
    </Show>
  );
}

export function AuthRoute() {
  const session = useSession();
  const location = useLocation();
  const next = () => safeNextPath(new URLSearchParams(location.search).get("next"));
  const returnTo = () => withoutSignInError(location.pathname, location.search);

  return (
    <main sx={styles.page}>
      <Show when={!session.isPending} fallback={<LoadingState label="Checking your session" />}>
        <Show when={session.data} fallback={<LogIn returnTo={returnTo()} />}>
          {(current) => (
            <Show
              when={current().user.hasSignInMethod}
              fallback={<ConnectSignInMethod email={current().user.email} returnTo={returnTo()} />}
            >
              <Redirect href={next()} />
            </Show>
          )}
        </Show>
      </Show>
    </main>
  );
}

function LogIn(props: { readonly returnTo: string }) {
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = createSignal(false);

  const submit = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (form: FormData) => {
      const result = await logInWithPassword(
        String(form.get("email") ?? ""),
        String(form.get("password") ?? ""),
      );
      if (!result.success) throw new Error(result.error);
      return result;
    },
    // The route then redirects, or asks password-only accounts to connect a sign-in method.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKey }),
  }));

  return (
    <div sx={styles.card}>
      <a href="/" aria-label="MacroGraph home" sx={styles.logoLink}>
        <img src={macrographLogo} alt="" sx={styles.logo} />
      </a>
      <h1 sx={styles.title}>Log in to MacroGraph</h1>
      <p sx={styles.description}>New to MacroGraph? Continuing creates your account.</p>
      <SignInError inCard />
      <SignInProviderButtons
        returnTo={props.returnTo}
        label={(provider) => `Continue with ${provider}`}
      />
      <Show
        when={showPassword()}
        fallback={
          <button type="button" sx={styles.legacyToggle} onClick={() => setShowPassword(true)}>
            Log in with email and password
          </button>
        }
      >
        <form
          sx={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit.mutate(new FormData(event.currentTarget));
          }}
        >
          <fieldset sx={styles.fieldset} disabled={submit.isPending}>
            <p sx={styles.legacyNote}>
              Email and password login is only for existing accounts, which need to connect a
              sign-in provider next.
            </p>
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
                autocomplete="current-password"
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
              {submit.isPending ? "Logging in..." : "Log in"}
            </Button>
          </fieldset>
        </form>
      </Show>
    </div>
  );
}

/** Password accounts connect a provider here before they can use anything else. */
function ConnectSignInMethod(props: { readonly email: string; readonly returnTo: string }) {
  const logOut = useLogOut();
  return (
    <div sx={styles.card}>
      <a href="/" aria-label="MacroGraph home" sx={styles.logoLink}>
        <img src={macrographLogo} alt="" sx={styles.logo} />
      </a>
      <h1 sx={styles.title}>Connect a sign-in method</h1>
      <p sx={styles.description}>
        MacroGraph is retiring email and password login. Connect an account to keep using{" "}
        <strong sx={styles.email}>{props.email}</strong>, and use it to log in from now on.
      </p>
      <SignInError inCard />
      <SignInProviderButtons
        returnTo={props.returnTo}
        label={(provider) => `Connect ${provider}`}
      />
      <button type="button" sx={styles.legacyToggle} onClick={() => logOut.mutate()}>
        Log out
      </button>
    </div>
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
  description: {
    margin: 0,
    marginTop: 8,
    marginBottom: 24,
    fontSize: 13,
    lineHeight: 1.5,
    color: colors.gray10,
  },
  email: { color: colors.gray12, fontWeight: 500 },
  providers: { display: "flex", flexDirection: "column", gap: 8 },
  providersLoading: { height: 96 },
  provider: {
    width: "100%",
    height: 40,
    boxSizing: "border-box",
    borderRadius: 8,
    gap: 8,
    fontSize: 14,
    textDecoration: "none",
  },
  providerIcon: { width: 16, height: 16, flexShrink: 0 },
  twitch: { color: "#9146FF" },
  github: { color: "#FFFFFF" },
  discord: { color: "#5865F2" },
  legacyToggle: {
    marginTop: 24,
    padding: 0,
    border: 0,
    backgroundColor: "transparent",
    fontSize: 13,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    cursor: "pointer",
  },
  legacyNote: { margin: 0, fontSize: 12, lineHeight: 1.5, color: colors.gray10 },
  form: {
    marginTop: 24,
    paddingTop: 24,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: 1,
  },
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
    textAlign: "left",
  },
  cardError: { marginBottom: 16 },
  submit: { width: "100%", height: 40, marginTop: 4, borderRadius: 8, fontSize: 14 },
});
