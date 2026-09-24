import { CredentialTable, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";

import { runApi, runApiResult } from "../api";
import { useWorkspace } from "../App";

const credentialsKey = ["account-credentials"] as const;

export const CredentialsRoute = () => {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const credentialsQuery = createQuery(() => ({
    queryKey: credentialsKey,
    queryFn: async () => {
      const catalog = await runApi(workspace.api.credentials.list());
      if (catalog === undefined) throw new Error("Could not load credentials");
      return catalog;
    },
    retry: false,
  }));
  const providersQuery = createQuery(() => ({
    queryKey: ["credential-providers"],
    queryFn: async () => (await runApi(workspace.api.credentials.providers())) ?? [],
    staleTime: 5 * 60 * 1_000,
  }));
  const credentials = () =>
    credentialsQuery.data?._tag === "CredentialCatalogAvailable"
      ? credentialsQuery.data.credentials
      : [];

  const connectCredential = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (provider: string) => {
      const popup = window.open(
        "about:blank",
        "macrograph-credential",
        "popup,width=720,height=760",
      );
      if (popup === null) throw new Error("Your browser blocked the credential window");
      sessionStorage.setItem("macrograph-credential-provider", provider);
      const connection = await runApi(workspace.api.credentials.connect({ params: { provider } }));
      if (connection === undefined) {
        popup.close();
        throw new Error("Could not start credential connection");
      }
      popup.location.replace(connection.authorizationUrl);
      await new Promise<void>((resolve, reject) => {
        const receive = (event: MessageEvent) => {
          if (
            event.origin !== location.origin ||
            event.source !== popup ||
            event.data?.type !== "macrograph-credential-connected"
          )
            return;
          window.removeEventListener("message", receive);
          resolve();
        };
        window.addEventListener("message", receive);
        const closed = window.setInterval(() => {
          if (!popup.closed) return;
          window.clearInterval(closed);
          window.removeEventListener("message", receive);
          reject(new Error("Credential connection was cancelled"));
        }, 500);
      });
    },
    onSuccess: () => void credentialsQuery.refetch(),
  }));

  const removeCredential = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (credential: { readonly provider: string; readonly id: string }) => {
      const removed = await runApiResult(
        workspace.api.credentials.remove({
          params: { provider: credential.provider, credentialId: credential.id },
        }),
      );
      if (!removed) throw new Error("Could not remove credential");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: credentialsKey }),
  }));

  return (
    <div sx={styles.root}>
      <div sx={styles.container}>
        <header sx={styles.header}>
          <div>
            <h1 sx={styles.title}>Credentials</h1>
            <p sx={styles.subtitle}>
              Connect external accounts to use them anywhere you're logged in to MacroGraph
            </p>
          </div>
          <select
            aria-label="Add credential"
            sx={styles.providerSelect}
            disabled={connectCredential.isPending || providersQuery.isPending}
            value=""
            onChange={(event) => {
              const provider = event.currentTarget.value;
              event.currentTarget.value = "";
              if (provider !== "") connectCredential.mutate(provider);
            }}
          >
            <option value="">
              {connectCredential.isPending ? "Connecting..." : "Add credential..."}
            </option>
            <For each={providersQuery.data ?? []}>
              {(provider) => <option value={provider.id}>{provider.displayName}</option>}
            </For>
          </select>
        </header>

        <Show when={connectCredential.isError}>
          <p role="alert" sx={styles.error}>
            {connectCredential.error?.message ?? "Could not connect credential."}
          </p>
        </Show>
        <Show when={removeCredential.isError}>
          <p role="alert" sx={styles.error}>
            Could not remove credential. Please try again.
          </p>
        </Show>

        <Show
          when={!credentialsQuery.isPending}
          fallback={<LoadingState label="Loading credentials" style={styles.loading} />}
        >
          <Show
            when={!credentialsQuery.isError}
            fallback={
              <div sx={styles.loadError}>
                <p>Credentials could not be loaded.</p>
                <button type="button" sx={styles.retry} onClick={() => credentialsQuery.refetch()}>
                  Try again
                </button>
              </div>
            }
          >
            <CredentialTable
              credentials={credentials()}
              onRemove={(credential) => removeCredential.mutate(credential)}
              removing={(credential) =>
                removeCredential.isPending &&
                removeCredential.variables?.provider === credential.provider &&
                removeCredential.variables.id === credential.id
              }
            />
          </Show>
        </Show>
      </div>
    </div>
  );
};

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  root: { height: "100%", overflowY: "auto", backgroundColor: colors.gray2 },
  container: {
    width: "100%",
    maxWidth: 800,
    marginInline: "auto",
    paddingInline: { default: 20, [sm]: 32 },
    paddingBlock: { default: 40, [sm]: 56 },
  },
  header: {
    display: "flex",
    flexDirection: { default: "column", [sm]: "row" },
    alignItems: { default: "stretch", [sm]: "flex-end" },
    justifyContent: "space-between",
    gap: 24,
    marginBottom: 28,
  },
  title: { fontSize: 28, lineHeight: "34px", fontWeight: 600, color: colors.gray12 },
  subtitle: { marginTop: 8, maxWidth: 520, fontSize: 14, lineHeight: "22px", color: colors.gray10 },
  providerSelect: {
    height: 36,
    flexShrink: 0,
    borderRadius: 6,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray12,
    paddingInline: 12,
    fontSize: 12,
    fontWeight: 600,
    color: colors.gray1,
    ":disabled": { opacity: 0.6 },
  },
  error: {
    marginBottom: 12,
    borderRadius: 6,
    border: `1px solid ${colors.red6}`,
    backgroundColor: colors.red3,
    padding: "10px 12px",
    fontSize: 12,
    color: colors.red11,
  },
  loading: { height: 120 },
  loadError: { padding: 24, fontSize: 13, color: colors.gray10 },
  retry: {
    marginTop: 12,
    borderRadius: 5,
    backgroundColor: {
      default: colors.gray3,
      ":hover": { default: null, "@media (hover: hover)": colors.gray4 },
    },
    padding: "7px 10px",
    fontSize: 12,
    color: colors.gray12,
  },
});
