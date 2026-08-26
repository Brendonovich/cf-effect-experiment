import type { Credential } from "@macrograph/plugin";
import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, createEffect } from "solid-js";

import { Avatar } from "../account/Avatar";
import { Button, ButtonLink } from "../ui/Button";
import { createStateMachine } from "../ui/createStateMachine.ts";
import { CredentialTable } from "./CredentialTable";
import { colors } from "../tokens.stylex.ts";

const styles = stylex.create({
  focusRing: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  disconnect: {
    flexShrink: 0,
    border: 0,
    borderRadius: 2,
    paddingBlock: 4,
    paddingInline: 8,
    fontSize: 12,
    color: colors.red10,
    backgroundColor: { default: "transparent", ":hover": colors.red3 },
  },
  refresh: {
    flexShrink: 0,
    border: 0,
    borderRadius: 2,
    backgroundColor: "transparent",
    opacity: { default: 1, ":disabled": 0.5 },
  },
  refreshCompact: {
    fontSize: 10,
    color: { default: colors.gray9, ":hover": colors.gray12 },
  },
  header: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 },
  headerTitle: { display: "flex", alignItems: "flex-end", gap: 6 },
  credentialHeading: { margin: 0, fontSize: 11, fontWeight: 500, color: colors.gray12 },
  count: {
    borderRadius: 9999,
    backgroundColor: colors.gray4,
    paddingBlock: 1,
    paddingInline: 6,
    fontSize: 9,
    fontVariantNumeric: "tabular-nums",
    color: colors.gray11,
  },
  card: {
    overflow: "hidden",
    borderColor: colors.gray4,
    borderRadius: 6,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray1,
  },
  identityRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBlock: 8,
    paddingInline: 10,
  },
  identity: { display: "flex", minWidth: 0, alignItems: "center", gap: 10 },
  avatar: { width: 28, height: 28 },
  identityName: {
    overflow: "hidden",
    margin: 0,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    fontWeight: 500,
    color: colors.gray12,
  },
  credentialCard: { marginTop: 8 },
  warning: { margin: 0, paddingInline: 10, paddingTop: 8, fontSize: 12, color: "#ffc53d" },
  accountHeading: { margin: 0, fontWeight: 500, color: colors.gray12 },
  description: {
    marginBottom: 0,
    marginTop: 4,
    fontSize: 12,
    lineHeight: "20px",
    color: colors.gray11,
  },
  status: { marginBottom: 0, marginTop: 16, fontSize: 12, color: colors.gray11 },
  connect: { marginTop: 16 },
  pending: {
    marginTop: 16,
    borderLeftColor: "#8f6424",
    borderLeftStyle: "solid",
    borderLeftWidth: 2,
    paddingLeft: 12,
  },
  pendingTitle: { margin: 0, fontSize: 12, fontWeight: 500, color: colors.gray12 },
  pendingDescription: {
    marginBottom: 0,
    marginTop: 4,
    fontSize: 12,
    lineHeight: "20px",
    color: colors.gray11,
  },
  pendingActions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  check: {
    borderColor: colors.gray6,
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    paddingBlock: 6,
    paddingInline: 12,
    fontSize: 12,
    color: colors.gray11,
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
  },
  section: { boxSizing: "border-box", width: "100%", maxWidth: 672, padding: 12, fontSize: 14 },
  error: { marginBottom: 0, marginTop: 12, fontSize: 12, color: colors.red10 },
});

export interface CredentialClient {
  readonly GetCredentialAuth: () => Effect.Effect<Credential.AuthState | null, unknown>;
  readonly StartCredentialAuth: () => Effect.Effect<Credential.AuthState, unknown>;
  readonly PollCredentialAuth: () => Effect.Effect<Credential.AuthState, unknown>;
  readonly DisconnectCredentialAuth: () => Effect.Effect<void, unknown>;
  readonly GetCredentialCatalog: () => Effect.Effect<Credential.Catalog, unknown>;
  readonly RefetchCredentials: () => Effect.Effect<Credential.Catalog, unknown>;
}

export interface CredentialSettingsProps {
  readonly client: () => CredentialClient | null;
  readonly description?: JSX.Element;
  readonly loadingLabel?: string;
  readonly onChanged?: () => void | Promise<void>;
}

interface CredentialContext {
  readonly auth: Credential.AuthState | null | undefined;
  readonly catalog: Credential.Catalog | undefined;
}

type CredentialOperation = "connect" | "disconnect" | "refresh";

type CredentialMode =
  | { readonly type: "loading" | "idle" }
  | { readonly type: "operation"; readonly operation: CredentialOperation }
  | { readonly type: "error"; readonly error: string };

interface CredentialState {
  context: CredentialContext;
  mode: CredentialMode;
}

const stateByClient = new WeakMap<CredentialClient, CredentialContext>();

const message = (error: unknown) =>
  typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : "The credential operation failed";

export function CredentialSettings(props: CredentialSettingsProps) {
  const initialState: CredentialState = {
    context: { auth: undefined, catalog: undefined },
    mode: { type: "loading" },
  };
  const [authorization, actions] = createStateMachine(initialState, {
    reset(state) {
      state.context = { auth: undefined, catalog: undefined };
      state.mode = { type: "loading" };
    },
    reconnect(state) {
      state.mode = { type: "loading" };
    },
    transportUnavailable(state) {
      state.mode = { type: "idle" };
    },
    update(state, context: CredentialContext) {
      state.context = context;
      if (state.mode.type !== "operation") state.mode = { type: "idle" };
    },
    startOperation(state, operation: CredentialOperation) {
      state.mode = { type: "operation", operation };
    },
    finishOperation(state, operation: CredentialOperation) {
      if (state.mode.type === "operation" && state.mode.operation === operation) {
        state.mode = { type: "idle" };
      }
    },
    failure(state, error: string) {
      state.mode = { type: "error", error };
    },
  });
  let previousClient: CredentialClient | null = null;
  let transportGeneration = 0;

  const phase = () => authorization.context.auth?.status.state ?? "loading";
  const operation = () => {
    const mode = authorization.mode;
    return mode.type === "operation" ? mode.operation : null;
  };
  const error = () => {
    const mode = authorization.mode;
    return mode.type === "error" ? mode.error : "";
  };

  const update = (
    client: CredentialClient,
    auth: Credential.AuthState | null | undefined,
    catalog: Credential.Catalog | undefined,
    generation: number,
  ) => {
    if (props.client() !== client || transportGeneration !== generation) return false;
    const context = { auth, catalog };
    stateByClient.set(client, context);
    actions.update(context);
    return true;
  };

  const verificationUrl = () => {
    const status = authorization.context.auth?.status;
    if (status?.state !== "pending") return undefined;
    try {
      const url = new URL(status.verificationUrl);
      return url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  };

  const poll = async () => {
    const client = props.client();
    const generation = transportGeneration;
    if (client === null || phase() !== "pending") return;
    try {
      const next = await Effect.runPromise(client.PollCredentialAuth());
      if (!update(client, next, authorization.context.catalog, generation)) return;
      if (next.status.state !== "pending") {
        const nextCatalog = await Effect.runPromise(client.RefetchCredentials());
        if (!update(client, next, nextCatalog, generation)) return;
        await props.onChanged?.();
      }
    } catch (cause) {
      if (props.client() === client && transportGeneration === generation) {
        actions.failure(message(cause));
      }
    }
  };
  const run = async (
    operation: CredentialOperation,
    perform: (client: CredentialClient | null, generation: number) => Promise<void>,
  ) => {
    const client = props.client();
    const generation = transportGeneration;
    actions.startOperation(operation);
    try {
      await perform(client, generation);
    } catch (cause) {
      if (props.client() === client && transportGeneration === generation) {
        actions.failure(message(cause));
      }
    } finally {
      if (props.client() === client && transportGeneration === generation) {
        actions.finishOperation(operation);
      }
    }
  };

  createEffect(
    () => props.client(),
    (client) => {
      const generation = ++transportGeneration;
      if (client === null) {
        previousClient = null;
        actions.transportUnavailable();
        return;
      }
      if (previousClient !== null && previousClient !== client) actions.reset();
      else actions.reconnect();
      previousClient = client;
      const cached = stateByClient.get(client);
      if (cached !== undefined) actions.update(cached);
      void (async () => {
        const [nextAuth, nextCatalog] = await Promise.all([
          Effect.runPromise(client.GetCredentialAuth()),
          Effect.runPromise(client.GetCredentialCatalog()),
        ]);
        update(client, nextAuth, nextCatalog, generation);
      })().catch((cause: unknown) => {
        if (props.client() === client && transportGeneration === generation) {
          actions.failure(message(cause));
        }
      });
    },
  );
  createEffect(
    () => (phase() === "pending" && error() === "" ? props.client() : null),
    (client) => {
      if (client === null) return;
      const timer = window.setInterval(() => void poll(), 2_000);
      return () => window.clearInterval(timer);
    },
  );

  const connect = () => {
    const authorizationWindow = window.open(
      "about:blank",
      "macrograph-device-authorization",
      "popup,width=520,height=720",
    );
    if (authorizationWindow !== null) {
      authorizationWindow.opener = null;
      authorizationWindow.document.title = "MacroGraph authorization";
      authorizationWindow.document.body.textContent = "Preparing MacroGraph authorization...";
    }
    return run("connect", async (client, generation) => {
      if (client === null) {
        authorizationWindow?.close();
        return;
      }
      try {
        const next = await Effect.runPromise(client.StartCredentialAuth());
        if (!update(client, next, authorization.context.catalog, generation)) {
          authorizationWindow?.close();
          return;
        }
        if (next.status.state === "pending") {
          const verification = new URL(next.status.verificationUrl);
          if (verification.protocol !== "https:") throw new Error("Unsafe verification URL");
          if (authorizationWindow !== null) authorizationWindow.location.replace(verification.href);
        } else authorizationWindow?.close();
      } catch (cause) {
        authorizationWindow?.close();
        throw cause;
      }
    });
  };
  const disconnect = () =>
    run("disconnect", async (client, generation) => {
      if (client === null) return;
      await Effect.runPromise(client.DisconnectCredentialAuth());
      const nextAuth: Credential.AuthState = {
        providerName: authorization.context.auth?.providerName ?? "Credential provider",
        status: { state: "disconnected" },
      };
      const nextCatalog = await Effect.runPromise(client.GetCredentialCatalog());
      if (!update(client, nextAuth, nextCatalog, generation)) return;
      await props.onChanged?.();
    });
  const refetch = () =>
    run("refresh", async (client, generation) => {
      if (client === null) return;
      const nextCatalog = await Effect.runPromise(client.RefetchCredentials());
      if (!update(client, authorization.context.auth, nextCatalog, generation)) return;
      await props.onChanged?.();
    });

  const available = () => {
    const value = authorization.context.catalog;
    return value?._tag === "CredentialCatalogAvailable" ? value.credentials : [];
  };
  const identity = () => {
    const status = authorization.context.auth?.status;
    return status?.state === "connected" ? status.identity : undefined;
  };
  const unavailableReason = () => {
    const value = authorization.context.catalog;
    return value?._tag === "CredentialCatalogUnavailable" ? value.reason.message : undefined;
  };

  const disconnectButton = () => (
    <button
      type="button"
      sx={[styles.focusRing, styles.disconnect]}
      disabled={operation() !== null}
      onClick={() => void disconnect()}
    >
      Disconnect
    </button>
  );

  const refreshButton = () => (
    <button
      type="button"
      sx={[styles.focusRing, styles.refresh, styles.refreshCompact]}
      disabled={operation() !== null || phase() !== "connected"}
      onClick={() => void refetch()}
    >
      {operation() === "refresh" ? "Refreshing..." : "Refresh"}
    </button>
  );

  const credentialsHeader = () => (
    <div sx={styles.header}>
      <div sx={styles.headerTitle}>
        <h4 sx={styles.credentialHeading}>Credentials</h4>
        <span sx={styles.count}>{available().length}</span>
      </div>
      {refreshButton()}
    </div>
  );

  const accountIdentity = () => (
    <div style={{ "margin-top": "16px" }}>
      <div sx={styles.card}>
        <div sx={styles.identityRow}>
          <div sx={styles.identity}>
            <Avatar email={identity()?.displayName ?? ""} style={styles.avatar} />
            <p sx={styles.identityName}>{identity()?.displayName ?? ""}</p>
          </div>
          {disconnectButton()}
        </div>
      </div>
    </div>
  );

  const accountPanel = () => (
    <div>
      <h3 sx={styles.accountHeading}>MacroGraph account</h3>
      <p sx={styles.description}>
        {props.description ?? "Authorize access to credentials managed by macrograph.app."}
      </p>
      <Show
        when={phase() !== "loading"}
        fallback={
          <p sx={styles.status}>
            {props.loadingLabel ?? "Loading authorization..."}
          </p>
        }
      >
        <Show
          when={phase() === "connected"}
          fallback={
            <Show
              when={phase() === "pending"}
              fallback={
                <Button
                  type="button"
                  sx={styles.connect}
                  disabled={operation() !== null}
                  onClick={() => void connect()}
                >
                  Connect MacroGraph
                </Button>
              }
            >
              <div sx={styles.pending}>
                <p sx={styles.pendingTitle}>
                  Finish authorization in the MacroGraph window
                </p>
                <p sx={styles.pendingDescription}>
                  This page checks automatically while you approve the device connection.
                </p>
                <div sx={styles.pendingActions}>
                  <Show when={verificationUrl()}>
                    {(url) => (
                      <ButtonLink href={url()} target="_blank" rel="noopener noreferrer">
                        Open authorization
                      </ButtonLink>
                    )}
                  </Show>
                  <button
                    type="button"
                    sx={[styles.focusRing, styles.check]}
                    disabled={operation() !== null}
                    onClick={() => void poll()}
                  >
                    Check now
                  </button>
                </div>
              </div>
            </Show>
          }
        >
          {accountIdentity()}
          <div style={{ "margin-top": "16px" }}>{credentialsHeader()}</div>
          <div sx={styles.credentialCard}>
            <Show when={unavailableReason()}>
              {(reason) => <p sx={styles.warning}>{reason()}</p>}
            </Show>
            <CredentialTable credentials={available()} />
          </div>
        </Show>
      </Show>
    </div>
  );

  return (
    <section sx={styles.section}>
      {accountPanel()}
      <Show when={error()}>
        <p sx={styles.error} role="status">
          {error()}
        </p>
      </Show>
    </section>
  );
}
