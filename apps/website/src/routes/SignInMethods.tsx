import { Button, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";

import {
  getSignInMethods,
  getSignInProviders,
  removeSignInMethod,
  signInMethodsKey,
  signInProvidersKey,
} from "../api";
import { showToast } from "../Toasts";
import { ProviderIcon, SignInError, SignInProviderButtons } from "./Auth";

const returnTo = "/account/sign-in";

export function SignInMethodsRoute() {
  const queryClient = useQueryClient();
  const methods = createQuery(() => ({ queryKey: signInMethodsKey, queryFn: getSignInMethods }));
  const providers = createQuery(() => ({
    queryKey: signInProvidersKey,
    queryFn: getSignInProviders,
    staleTime: Infinity,
  }));
  const providerName = (id: string) =>
    providers.data?.find((provider) => provider.id === id)?.displayName ?? id;

  const remove = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: removeSignInMethod,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signInMethodsKey }),
    onError: () =>
      showToast({
        tone: "error",
        content: "Could not remove the sign-in method. Please try again.",
      }),
  }));
  const removing = (providerId: string, providerUserId: string) =>
    remove.isPending &&
    remove.variables?.providerId === providerId &&
    remove.variables.providerUserId === providerUserId;

  return (
    <div sx={styles.root}>
      <header sx={styles.header}>
        <h1 sx={styles.title}>Sign-in methods</h1>
        <p sx={styles.subtitle}>
          Accounts you can log in to MacroGraph with. Credentials for graphs are managed separately.
        </p>
      </header>
      <SignInError />
      <Show
        when={!methods.isPending}
        fallback={<LoadingState label="Loading sign-in methods" style={styles.loading} />}
      >
        <div sx={styles.list}>
          <Show
            when={!methods.isError}
            fallback={
              <p sx={styles.empty}>
                Sign-in methods could not be loaded.{" "}
                <button type="button" sx={styles.retry} onClick={() => void methods.refetch()}>
                  Try again
                </button>
              </p>
            }
          >
            <For each={methods.data ?? []}>
              {(method) => (
                <div sx={styles.row}>
                  <span sx={styles.icon} aria-hidden="true">
                    <ProviderIcon provider={method.providerId} />
                  </span>
                  <div sx={styles.body}>
                    <p sx={styles.name}>{method.displayName ?? method.providerUserId}</p>
                    <p sx={styles.detail}>
                      {providerName(method.providerId)}
                      {method.email === null ? "" : ` · ${method.email}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    sx={styles.remove}
                    // Every account keeps at least one way to log in.
                    disabled={
                      (methods.data?.length ?? 0) <= 1 ||
                      removing(method.providerId, method.providerUserId)
                    }
                    title={
                      (methods.data?.length ?? 0) <= 1
                        ? "Connect another sign-in method before removing this one"
                        : undefined
                    }
                    onClick={() => remove.mutate(method)}
                  >
                    {removing(method.providerId, method.providerUserId) ? "Removing..." : "Remove"}
                  </Button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <section sx={styles.connect}>
        <h2 sx={styles.sectionTitle}>Connect another</h2>
        <SignInProviderButtons returnTo={returnTo} label={(provider) => `Connect ${provider}`} />
      </section>
    </div>
  );
}

const narrow = "@media (max-width: 639px)";
const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: { default: 32, [narrow]: 24 } },
  header: { paddingInline: { default: 0, [narrow]: 16 } },
  title: { margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 500 },
  subtitle: { margin: 0, marginTop: 4, fontSize: 14, lineHeight: "20px", color: colors.gray11 },
  loading: { height: 120 },
  list: {
    overflow: "hidden",
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderInlineWidth: { default: 1, [narrow]: 0 },
    borderRadius: { default: 8, [narrow]: 0 },
    backgroundColor: colors.gray2,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    paddingBlock: 14,
    paddingInline: 16,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  icon: {
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
    width: 32,
    height: 32,
    borderColor: "rgb(255 255 255 / 0.08)",
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 7,
    backgroundColor: colors.gray4,
    color: colors.gray11,
  },
  body: { flex: 1, minWidth: 0 },
  remove: { flexShrink: 0, borderRadius: 6 },
  name: { margin: 0, fontSize: 15, lineHeight: "20px", fontWeight: 500 },
  detail: {
    margin: 0,
    marginTop: 2,
    overflow: "hidden",
    fontSize: 13,
    color: colors.gray10,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: { margin: 0, padding: 20, fontSize: 13, color: colors.gray10 },
  retry: {
    border: 0,
    padding: 0,
    backgroundColor: "transparent",
    fontSize: 13,
    color: colors.gray12,
    textDecoration: "underline",
    cursor: "pointer",
  },
  connect: { maxWidth: 320, paddingInline: { default: 0, [narrow]: 16 } },
  sectionTitle: { margin: 0, marginBottom: 12, fontSize: 14, fontWeight: 500 },
});
