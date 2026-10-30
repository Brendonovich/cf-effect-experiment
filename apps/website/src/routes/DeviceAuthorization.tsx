import { Button, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/solid-query";
import { Match, Show, Switch, createSignal, onSettled, untrack } from "solid-js";

import { type Session, websiteRequest } from "../api";
import { RequireSession } from "../session";

/** `device` approves the desktop app; `server-registration` adds a self-hosted server. */
export type DeviceFlow = "device" | "server-registration";

const copy: Record<DeviceFlow, { readonly title: string; readonly grant: string }> = {
  device: {
    title: "Connect a device",
    grant: "The device will be able to use your account and all of its credentials.",
  },
  "server-registration": {
    title: "Register a server",
    grant: "The server will be registered to your account and can use all of its credentials.",
  },
};

export function DeviceAuthorizationRoute(props: { readonly flow: DeviceFlow }) {
  return (
    <main sx={styles.page}>
      <div sx={styles.content}>
        <a href="/" sx={[styles.brand]}>
          <img src={macrographLogo} alt="" sx={styles.logo} />
          MacroGraph
        </a>
        <RequireSession>
          {(session) => <DeviceAuthorization flow={props.flow} session={session} />}
        </RequireSession>
      </div>
    </main>
  );
}

type Step = { readonly state: "enter-code" } | { readonly state: "confirm"; readonly code: string };

function DeviceAuthorization(props: { readonly flow: DeviceFlow; readonly session: Session }) {
  const location = useLocation();
  const navigate = useNavigate();
  const initialCode = untrack(() => new URLSearchParams(location.search).get("userCode") ?? "");
  const [code, setCode] = createSignal(initialCode);
  const [step, setStep] = createSignal<Step>({ state: "enter-code" });
  const [granted, setGranted] = createSignal(false);

  const verify = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (userCode: string) => {
      const valid = await websiteRequest<boolean>(`/${props.flow}/verify`, {
        method: "POST",
        body: { userCode },
      });
      if (!valid) throw new Error("That code wasn't recognised. Check it and try again.");
      return userCode;
    },
    onSuccess: (userCode) => setStep({ state: "confirm", code: userCode }),
  }));

  const grant = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (userCode: string) => {
      const result = await websiteRequest<{ error: string } | null>(`/${props.flow}/grant`, {
        method: "POST",
        body: { userCode },
      });
      if (result !== null) throw new Error(result.error);
    },
    onSuccess: () => {
      setGranted(true);
      // Only closes when the device opened this tab; the success message covers other cases.
      window.close();
    },
  }));

  onSettled(() => {
    if (initialCode === "") return;
    // Codes are single-use secrets; keep them out of history once read.
    navigate(location.pathname, { replace: true });
    verify.mutate(initialCode);
  });

  const signedInAs = () => (
    <p sx={styles.signedIn}>
      Signed in as <strong sx={styles.email}>{props.session.user.email}</strong>
    </p>
  );

  return (
    <div sx={styles.card}>
      <Switch>
        <Match when={granted()}>
          <IconTablerCheck {...stylex.attrs(styles.doneIcon)} />
          <h1 sx={styles.title}>Access granted</h1>
          <p sx={styles.description}>You can close this window and return to MacroGraph.</p>
        </Match>
        <Match when={step().state === "enter-code"}>
          <h1 sx={styles.title}>{copy[props.flow].title}</h1>
          {signedInAs()}
          <form
            sx={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              verify.mutate(code().trim().toUpperCase());
            }}
          >
            <label sx={styles.codeLabel} for="user-code">
              Enter the code shown on your device
            </label>
            <input
              id="user-code"
              value={code()}
              onInput={(event) => setCode(event.currentTarget.value)}
              maxlength={9}
              autocomplete="off"
              spellcheck={false}
              placeholder="XXXX-XXXX"
              aria-invalid={verify.isError ? "true" : "false"}
              sx={styles.codeInput}
            />
            <Show when={verify.error}>
              {(error) => (
                <p role="alert" sx={styles.error}>
                  {error().message}
                </p>
              )}
            </Show>
            <Button
              type="submit"
              sx={styles.fullButton}
              disabled={verify.isPending || code().trim().length < 9}
            >
              {verify.isPending ? "Checking..." : "Continue"}
            </Button>
          </form>
          <p sx={styles.hint}>
            MacroGraph staff will never ask you to enter your code on this page.
          </p>
        </Match>
        <Match when={step().state === "confirm"}>
          <h1 sx={styles.title}>Confirm access</h1>
          {signedInAs()}
          <p sx={styles.description}>{copy[props.flow].grant} Only continue if you started this.</p>
          <Show when={grant.error}>
            {(error) => (
              <p role="alert" sx={styles.error}>
                {error().message}
              </p>
            )}
          </Show>
          <div sx={styles.buttons}>
            <Button
              type="button"
              variant="secondary"
              sx={styles.button}
              disabled={grant.isPending}
              onClick={() => navigate("/")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              sx={styles.button}
              disabled={grant.isPending}
              onClick={() => {
                const current = step();
                if (current.state === "confirm") grant.mutate(current.code);
              }}
            >
              {grant.isPending ? "Granting..." : "Grant access"}
            </Button>
          </div>
        </Match>
      </Switch>
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
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 28,
    width: "100%",
    maxWidth: 420,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: colors.gray12,
    textDecoration: "none",
  },
  logo: { width: 44, height: 44, borderRadius: 10 },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    boxSizing: "border-box",
    padding: 28,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: colors.gray2,
    textAlign: "center",
  },
  title: { margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" },
  signedIn: { margin: 0, marginTop: 6, fontSize: 13, color: colors.gray10 },
  email: { fontWeight: 500, color: colors.gray12 },
  description: { margin: 0, marginTop: 16, fontSize: 14, lineHeight: "22px", color: colors.gray11 },
  form: { display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 24 },
  codeLabel: { fontSize: 13, fontWeight: 500, color: colors.gray11 },
  codeInput: {
    height: 60,
    boxSizing: "border-box",
    borderColor: { default: colors.gray5, ":focus": colors.gray8 },
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray1,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textAlign: "center",
    textTransform: "uppercase",
    color: colors.gray12,
    outline: "none",
    "::placeholder": { color: colors.gray7 },
  },
  error: {
    margin: 0,
    marginTop: 12,
    width: "100%",
    boxSizing: "border-box",
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
  fullButton: { width: "100%", height: 40, borderRadius: 8, fontSize: 14 },
  hint: { margin: 0, marginTop: 16, fontSize: 12, color: colors.gray9 },
  buttons: { display: "flex", gap: 8, width: "100%", marginTop: 24 },
  button: { flex: 1, height: 40, borderRadius: 8, fontSize: 14 },
  doneIcon: { width: 36, height: 36, marginBottom: 12, color: "#3dd68c" },
});
