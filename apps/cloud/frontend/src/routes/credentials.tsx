import { CredentialIntegrations, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";

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

  const errors = () => (
    <>
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
    </>
  );

  return (
    <div sx={styles.root}>
      <div sx={styles.container}>
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
            <CredentialIntegrations
              description="Connect external accounts to use them anywhere you're logged in to MacroGraph."
              providers={providersQuery.data ?? []}
              credentials={credentials()}
              notice={errors()}
              onConnect={(provider) => connectCredential.mutate(provider)}
              connecting={(provider) =>
                connectCredential.isPending && connectCredential.variables === provider
              }
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
  error: {
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
    backgroundColor: { default: colors.gray3, ":hover": colors.gray4 },
    padding: "7px 10px",
    fontSize: 12,
    color: colors.gray12,
  },
});
