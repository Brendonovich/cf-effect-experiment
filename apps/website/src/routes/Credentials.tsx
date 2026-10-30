import { CredentialIntegrations, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";

import {
  ConnectionCancelledError,
  connectCredential,
  connectableProviders,
  credentialsKey,
  getCredentials,
  providerDisplayNames,
  removeCredential,
  toCredentialSummary,
} from "../api";
import { showToast } from "../Toasts";

const providers = connectableProviders.map((id) => ({ id, displayName: providerDisplayNames[id] }));
const providerName = (id: string) =>
  id in providerDisplayNames ? providerDisplayNames[id as keyof typeof providerDisplayNames] : id;

export function CredentialsRoute() {
  const queryClient = useQueryClient();
  const credentials = createQuery(() => ({ queryKey: credentialsKey, queryFn: getCredentials }));

  const connect = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: connectCredential,
    onSuccess: (result, provider) => {
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
      showToast({
        tone: "success",
        content: (
          <>
            Connected <strong>{result.user.displayName}</strong> from {providerName(provider)}
          </>
        ),
      });
    },
    onError: (error) => {
      if (!(error instanceof ConnectionCancelledError))
        showToast({ tone: "error", content: error.message });
    },
  }));

  const remove = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: removeCredential,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: credentialsKey }),
    onError: () =>
      showToast({ tone: "error", content: "Could not remove the credential. Please try again." }),
  }));

  return (
    <Show
      when={!credentials.isPending}
      fallback={<LoadingState label="Loading credentials" style={styles.loading} />}
    >
      <Show
        when={!credentials.isError}
        fallback={
          <div sx={styles.loadError}>
            <p>Credentials could not be loaded.</p>
            <button type="button" sx={styles.retry} onClick={() => void credentials.refetch()}>
              Try again
            </button>
          </div>
        }
      >
        <CredentialIntegrations
          description="Add credentials to your account to use them within MacroGraph."
          providers={providers}
          credentials={(credentials.data ?? []).map(toCredentialSummary)}
          showStatus={false}
          onConnect={(provider) => connect.mutate(provider)}
          connecting={(provider) => connect.isPending && connect.variables === provider}
          onRemove={(credential) => remove.mutate(credential)}
          removing={(credential) =>
            remove.isPending &&
            remove.variables?.provider === credential.provider &&
            remove.variables.id === credential.id
          }
        />
      </Show>
    </Show>
  );
}

const styles = stylex.create({
  loading: { height: 160 },
  loadError: { paddingBlock: 24, fontSize: 14, color: colors.gray10 },
  retry: {
    marginTop: 12,
    paddingBlock: 7,
    paddingInline: 10,
    border: 0,
    borderRadius: 6,
    backgroundColor: { default: colors.gray3, ":hover": colors.gray4 },
    fontSize: 13,
    color: colors.gray12,
    cursor: "pointer",
  },
});
