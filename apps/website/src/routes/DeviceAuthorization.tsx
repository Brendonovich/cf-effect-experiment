import { Button, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation } from "@tanstack/solid-query";
import { For, Match, Show, Switch, createMemo, createSignal, onSettled, untrack } from "solid-js";

import {
  ApiError,
  type DeviceRequest,
  type OAuthScope,
  type Session,
  decideDeviceRequest,
  lookupDeviceRequest,
} from "../api";
import { RequireSession } from "../session";

export const scopeDescriptions: Record<OAuthScope, string> = {
  openid: "Know which account you are",
  email: "See your email address",
  offline_access: "Stay signed in until you remove it",
  credentials: "Use your connected accounts, like Twitch and Discord",
};

const scopeIcons: Record<OAuthScope, typeof IconTablerUser> = {
  openid: IconTablerUser,
  email: IconTablerMail,
  offline_access: IconTablerRefresh,
  credentials: IconTablerKey,
};

/** Scopes that let the client act as the user elsewhere, shown with a warning. */
const scopeWarnings: Partial<Record<OAuthScope, string>> = {
  credentials:
    "This server can post, read, and act as you on those services. Only approve servers you trust.",
};

const sortedScopes = (scopes: ReadonlyArray<OAuthScope>) => [
  ...scopes.filter((scope) => scopeWarnings[scope] === undefined),
  ...scopes.filter((scope) => scopeWarnings[scope] !== undefined),
];

/** Approves a device authorization request (RFC 8628) started by a server or app. */
export function DeviceAuthorizationRoute() {
  return (
    <main sx={styles.page}>
      <div sx={styles.content}>
        <a href="/" sx={[styles.brand]}>
          <img src={macrographLogo} alt="" sx={styles.logo} />
          MacroGraph
        </a>
        <RequireSession>{(session) => <DeviceAuthorization session={session} />}</RequireSession>
      </div>
    </main>
  );
}

type Step =
  | { readonly state: "enter-code" }
  | { readonly state: "confirm"; readonly request: DeviceRequest }
  | { readonly state: "done"; readonly approved: boolean };

const notFoundMessage = "That code wasn't recognised or has expired. Check it and try again.";
const rateLimitedMessage = "Too many attempts. Wait a few minutes and try again.";

/** Looks up the code a device linked to, reporting failures as data so the page still renders. */
const lookupLinkedRequest = async (userCode: string) => {
  try {
    const request = await lookupDeviceRequest(userCode);
    return request === null ? { error: notFoundMessage } : { request };
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) return { error: rateLimitedMessage };
    throw error;
  }
};

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const requestOrigin = (request: DeviceRequest) =>
  [request.requestIp, request.requestCountry === null ? null : countryName(request.requestCountry)]
    .filter((part) => part !== null)
    .join(" · ");

function DeviceAuthorization(props: { readonly session: () => Session }) {
  const location = useLocation();
  const navigate = useNavigate();
  const initialCode = untrack(() => new URLSearchParams(location.search).get("user_code") ?? "");
  const [code, setCode] = createSignal(initialCode);
  // The code from the link is looked up while rendering, so the server sends the request with it.
  const linked = createQuery(() => ({
    queryKey: ["device-request", initialCode],
    queryFn: () => lookupLinkedRequest(initialCode),
    enabled: initialCode !== "",
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  }));
  const [chosen, setStep] = createSignal<Step | undefined>(undefined);
  const step = createMemo((): Step => {
    const current = chosen();
    if (current !== undefined) return current;
    const request = linked.data?.request;
    return request ? { state: "confirm", request } : { state: "enter-code" };
  });

  const lookup = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (userCode: string) => {
      try {
        const request = await lookupDeviceRequest(userCode);
        if (request === null) throw new Error(notFoundMessage);
        return request;
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) throw new Error(rateLimitedMessage);
        throw error;
      }
    },
    onSuccess: (request) => setStep({ state: "confirm", request }),
  }));

  const linkedError = createMemo(() =>
    chosen() !== undefined || lookup.isPending ? undefined : linked.data?.error,
  );

  const decide = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (input: { readonly userCode: string; readonly approve: boolean }) => {
      const decided = await decideDeviceRequest(input.userCode, input.approve ? "approve" : "deny");
      if (!decided) throw new Error("This request has expired. Start again on your device.");
      return input.approve;
    },
    onSuccess: (approved) => setStep({ state: "done", approved }),
  }));

  onSettled(() => {
    if (initialCode === "") return;
    // Codes grant access once approved; keep them out of history once read. Navigating flushes,
    // which `onSettled` must not do synchronously.
    queueMicrotask(() => navigate(location.pathname, { replace: true }));
  });

  const signedInAs = () => (
    <p sx={styles.signedIn}>
      Signed in as <strong sx={styles.email}>{props.session().user.email}</strong>
    </p>
  );

  const confirming = () => {
    const current = step();
    return current.state === "confirm" ? current.request : undefined;
  };
  const done = () => {
    const current = step();
    return current.state === "done" ? current : undefined;
  };

  return (
    <div sx={styles.card}>
      <Switch>
        <Match when={done()}>
          {(result) => (
            <>
              <Show
                when={result().approved}
                fallback={<IconTablerX {...stylex.attrs(styles.doneIcon, styles.deniedIcon)} />}
              >
                <IconTablerCheck {...stylex.attrs(styles.doneIcon)} />
              </Show>
              <h1 sx={styles.title}>{result().approved ? "Access granted" : "Request denied"}</h1>
              <p sx={styles.description}>
                {result().approved
                  ? "You can close this window and return to your device."
                  : "Nothing was shared. You can close this window."}
              </p>
            </>
          )}
        </Match>
        <Match when={confirming()}>
          {(request) => (
            <>
              <h1 sx={styles.title}>Approve sign-in?</h1>
              {signedInAs()}
              <div sx={styles.codePanel}>
                <p sx={styles.codePanelLabel}>Check this matches your device</p>
                <p sx={styles.code} aria-label="Code">
                  {request().userCode}
                </p>
              </div>

              <div sx={styles.details}>
                <div sx={styles.client}>
                  <span sx={styles.clientName}>{request().client.name}</span>
                  <Show when={!request().client.verified}>
                    <span sx={styles.badge} title="MacroGraph hasn't checked who runs this server">
                      Unverified
                    </span>
                  </Show>
                </div>
                <Show when={requestOrigin(request()) !== ""}>
                  <p sx={styles.origin}>{requestOrigin(request())}</p>
                </Show>
                <ul sx={styles.scopeList}>
                  <For each={sortedScopes(request().scope)}>
                    {(scope) => {
                      const Icon = scopeIcons[scope];
                      const warning = scopeWarnings[scope];
                      return (
                        <li sx={[styles.scope, warning !== undefined && styles.dangerScope]}>
                          <Icon
                            {...stylex.attrs(
                              styles.scopeIcon,
                              warning !== undefined && styles.dangerIcon,
                            )}
                          />
                          <div>
                            {scopeDescriptions[scope]}
                            <Show when={warning}>
                              {(text) => <p sx={styles.scopeWarning}>{text()}</p>}
                            </Show>
                          </div>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </div>

              <Show when={decide.error}>
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
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userCode: request().userCode, approve: false })}
                >
                  Deny
                </Button>
                <Button
                  type="button"
                  sx={styles.button}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userCode: request().userCode, approve: true })}
                >
                  {decide.isPending ? "Saving..." : "Approve"}
                </Button>
              </div>
            </>
          )}
        </Match>
        <Match when={step().state === "enter-code"}>
          <h1 sx={styles.title}>Connect a device</h1>
          {signedInAs()}
          <form
            sx={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              lookup.mutate(code().trim());
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
              aria-invalid={lookup.isError || linkedError() !== undefined ? "true" : "false"}
              sx={styles.codeInput}
            />
            <Show when={lookup.error?.message ?? linkedError()}>
              {(message) => (
                <p role="alert" sx={styles.error}>
                  {message()}
                </p>
              )}
            </Show>
            <Button
              type="submit"
              sx={styles.fullButton}
              disabled={lookup.isPending || code().replaceAll(/[^a-z]/gi, "").length < 8}
            >
              {lookup.isPending ? "Checking..." : "Continue"}
            </Button>
          </form>
          <p sx={styles.hint}>
            MacroGraph staff will never ask you to enter your code on this page.
          </p>
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
    gap: 14,
    fontSize: 30,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: colors.gray12,
    textDecoration: "none",
  },
  logo: { width: 56, height: 56, borderRadius: 12 },
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
  signedIn: { margin: 0, marginTop: 6, fontSize: 13, color: colors.gray11 },
  email: { fontWeight: 500, color: colors.gray12 },
  description: { margin: 0, marginTop: 16, fontSize: 14, lineHeight: "22px", color: colors.gray11 },
  codePanel: {
    width: "100%",
    marginTop: 24,
    paddingBlock: 16,
    boxSizing: "border-box",
    borderColor: colors.gray4,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray1,
  },
  codePanelLabel: { margin: 0, fontSize: 12, color: colors.gray11 },
  code: {
    margin: 0,
    marginTop: 8,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 30,
    fontWeight: 600,
    lineHeight: "36px",
    letterSpacing: "0.12em",
    // Letter spacing trails the last character; offset it so the code stays centred.
    paddingLeft: "0.12em",
  },
  details: {
    width: "100%",
    marginTop: 12,
    padding: 16,
    boxSizing: "border-box",
    borderColor: colors.gray4,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray1,
    textAlign: "left",
  },
  client: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  clientName: {
    overflow: "hidden",
    fontSize: 14,
    fontWeight: 600,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  origin: { margin: 0, marginTop: 2, fontSize: 12, color: colors.gray10 },
  badge: {
    flexShrink: 0,
    paddingBlock: 1,
    paddingInline: 6,
    borderRadius: 4,
    backgroundColor: "rgb(255 197 61 / 0.15)",
    fontSize: 11,
    fontWeight: 500,
    color: "#ffc53d",
  },
  scopeList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    margin: 0,
    marginTop: 14,
    paddingTop: 14,
    paddingLeft: 0,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    listStyle: "none",
    fontSize: 13,
    lineHeight: "20px",
    color: colors.gray12,
  },
  scope: { display: "flex", alignItems: "flex-start", gap: 10 },
  scopeIcon: { flexShrink: 0, width: 16, height: 16, marginTop: 2, color: colors.gray10 },
  // Bleeds into the details padding so its icon and text line up with the other scopes, keeping
  // the same 8px gutter on the sides and bottom. Warning scopes are sorted last.
  dangerScope: {
    marginInline: -8,
    marginBottom: -8,
    paddingBlock: 8,
    paddingInline: 8,
    borderColor: colors.red6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: colors.red3,
    color: colors.red12,
  },
  dangerIcon: { color: colors.red11 },
  scopeWarning: { margin: 0, marginTop: 2, fontSize: 12, lineHeight: "18px", color: colors.red11 },
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
  hint: { margin: 0, marginTop: 12, fontSize: 12, color: colors.gray9 },
  buttons: { display: "flex", gap: 8, width: "100%", marginTop: 24 },
  button: { flex: 1, height: 40, borderRadius: 8, fontSize: 14 },
  doneIcon: { width: 36, height: 36, marginBottom: 12, color: "#3dd68c" },
  deniedIcon: { color: colors.gray10 },
});
