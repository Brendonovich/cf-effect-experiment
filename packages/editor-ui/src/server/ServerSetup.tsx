import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";

import macrographLogo from "../macrograph-logo.png";
import { colors } from "../tokens.stylex.ts";
import { Button, ButtonLink } from "../ui/Button.tsx";

/** The card a self-hosted server shows until it is set up and the visitor is signed in. */
export function ServerSetupCard(props: { readonly children: JSX.Element }) {
  return (
    <section sx={styles.card} aria-labelledby="setup-title">
      <div sx={styles.brand}>
        <img src={macrographLogo} alt="" sx={styles.logo} />
        <span sx={styles.brandName}>MacroGraph</span>
      </div>
      {props.children}
    </section>
  );
}

export function ServerSetupConnecting(props: {
  readonly error?: string | null;
  readonly onRetry: () => void;
}) {
  return (
    <>
      <h1 id="setup-title" sx={styles.title}>
        Connecting to your server
      </h1>
      <Show
        when={props.error}
        fallback={
          <p sx={styles.description} role="status">
            Checking server status...
          </p>
        }
      >
        {(error) => (
          <>
            <p sx={styles.error} role="alert">
              {error()}
            </p>
            <Button type="button" onClick={() => props.onRetry()}>
              Retry
            </Button>
          </>
        )}
      </Show>
    </>
  );
}

export function ServerSetupForm(props: {
  readonly setupKey: string;
  readonly onSetupKeyInput: (key: string) => void;
  /** Setup links carry the key, so the field only shows when there's no key or it failed. */
  readonly showKeyInput: boolean;
  readonly error?: string | null;
  readonly onSubmit: (key: string) => void;
}) {
  return (
    <>
      <div sx={styles.heading}>
        <h1 id="setup-title" sx={styles.title}>
          Set up your server
        </h1>
        <p sx={styles.description}>
          The account you approve with becomes this server's administrator.
        </p>
      </div>
      <form
        sx={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (props.setupKey.trim()) props.onSubmit(props.setupKey.trim());
        }}
      >
        <Show when={props.showKeyInput}>
          <input
            type="password"
            aria-label="Setup key"
            placeholder="Setup key"
            autocomplete="off"
            spellcheck={false}
            required
            value={props.setupKey}
            aria-describedby="setup-key-help"
            sx={styles.input}
            onInput={(event) => props.onSetupKeyInput(event.currentTarget.value)}
          />
          <p id="setup-key-help" sx={styles.hint}>
            Printed in your server logs as <code>MACROGRAPH_SETUP_KEY</code>.
          </p>
        </Show>
        <Show when={props.error}>
          {(error) => (
            <p sx={styles.error} role="alert">
              {error()}
            </p>
          )}
        </Show>
        <Button type="submit" disabled={!props.setupKey.trim()} sx={styles.fullWidth}>
          Continue with MacroGraph
        </Button>
      </form>
    </>
  );
}

export function ServerSetupApproval(props: {
  readonly userCode: string | null;
  readonly verificationUrl: string | null;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <div sx={styles.heading}>
        <h1 id="setup-title" sx={styles.title}>
          Approve on macrograph.app
        </h1>
        <p sx={styles.description} role="status">
          {props.userCode === null ? "Opening macrograph.app..." : "Make sure it shows this code."}
        </p>
      </div>
      <Show when={props.userCode}>{(code) => <div sx={styles.userCode}>{code()}</div>}</Show>
      <div sx={styles.form}>
        <Show when={props.verificationUrl}>
          {(url) => (
            <ButtonLink
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              sx={styles.fullWidth}
            >
              Open macrograph.app
            </ButtonLink>
          )}
        </Show>
        <Button type="button" variant="text" onClick={() => props.onCancel()}>
          Cancel
        </Button>
      </div>
      <p sx={styles.hint}>This server will be able to use your cloud-managed credentials.</p>
    </>
  );
}

const styles = stylex.create({
  card: {
    backgroundColor: colors.gray2,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    gap: 24,
    margin: "auto",
    maxWidth: 400,
    padding: { default: 20, "@media (min-width: 600px)": 32 },
    width: "100%",
  },
  brand: { display: "flex", alignItems: "center", gap: 8, minHeight: 44 },
  logo: { borderRadius: 6, height: 28, width: 28 },
  brandName: { fontWeight: 600, letterSpacing: "-0.025em" },
  heading: { display: "flex", flexDirection: "column", gap: 6 },
  title: { fontSize: 20, fontWeight: 600, letterSpacing: "-0.025em", margin: 0 },
  description: { color: colors.gray11, lineHeight: 1.6, margin: 0, overflowWrap: "anywhere" },
  hint: { color: colors.gray10, fontSize: 12, margin: 0 },
  userCode: {
    backgroundColor: colors.gray1,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    color: colors.gray12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: "0.15em",
    paddingBlock: 16,
    textAlign: "center",
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  fullWidth: { width: "100%" },
  input: {
    backgroundColor: colors.gray1,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 4,
    color: colors.gray12,
    fontSize: 16,
    minWidth: 0,
    padding: 10,
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${colors.focus}` },
  },
  error: { color: colors.red11, lineHeight: 1.5, margin: 0, overflowWrap: "anywhere" },
});
