import { Button, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";

import { authorizationsKey, getAuthorizations, revokeAuthorization } from "../api";
import { showToast } from "../Toasts";

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function AppsRoute() {
  const queryClient = useQueryClient();
  const authorizations = createQuery(() => ({
    queryKey: authorizationsKey,
    queryFn: getAuthorizations,
  }));
  const revoke = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: revokeAuthorization,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authorizationsKey }),
    onError: () =>
      showToast({ tone: "error", content: "Could not remove the app. Please try again." }),
  }));

  return (
    <div sx={styles.root}>
      <header sx={styles.header}>
        <h1 sx={styles.title}>Apps</h1>
        <p sx={styles.subtitle}>
          Servers and apps that can use your credentials. Start a MacroGraph server and approve its
          sign-in code to add one.
        </p>
      </header>
      <Show
        when={!authorizations.isPending}
        fallback={<LoadingState label="Loading apps" style={styles.loading} />}
      >
        <div sx={styles.list}>
          <Show
            when={!authorizations.isError}
            fallback={
              <p sx={styles.empty}>
                Apps could not be loaded.{" "}
                <button
                  type="button"
                  sx={styles.retry}
                  onClick={() => void authorizations.refetch()}
                >
                  Try again
                </button>
              </p>
            }
          >
            <For
              each={authorizations.data ?? []}
              fallback={<p sx={styles.empty}>No apps can use your credentials yet.</p>}
            >
              {(authorization) => (
                <div sx={styles.row}>
                  <span sx={styles.icon} aria-hidden="true">
                    <Show
                      when={authorization.client.verified}
                      fallback={<IconTablerServer {...stylex.attrs(styles.iconSvg)} />}
                    >
                      <IconTablerAppWindow {...stylex.attrs(styles.iconSvg)} />
                    </Show>
                  </span>
                  <div sx={styles.body}>
                    <p sx={styles.name}>{authorization.client.name}</p>
                    <p sx={styles.detail}>
                      Approved {date.format(authorization.createdAt)} · Last used{" "}
                      {date.format(authorization.lastUsedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    sx={styles.remove}
                    disabled={revoke.isPending && revoke.variables === authorization.id}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${authorization.client.name}? It loses access to your credentials and has to be approved again.`,
                        )
                      )
                        revoke.mutate(authorization.id);
                    }}
                  >
                    {revoke.isPending && revoke.variables === authorization.id
                      ? "Removing..."
                      : "Remove"}
                  </Button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
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
  iconSvg: { width: 17, height: 17 },
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
});
