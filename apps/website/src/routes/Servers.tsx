import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";

import { getServers, serversKey } from "../api";

export function ServersRoute() {
  const servers = createQuery(() => ({ queryKey: serversKey, queryFn: getServers }));

  return (
    <div sx={styles.root}>
      <header sx={styles.header}>
        <h1 sx={styles.title}>Servers</h1>
        <p sx={styles.subtitle}>
          MacroGraph servers registered to your account. Run a server and approve its registration
          code to add one.
        </p>
      </header>
      <Show
        when={!servers.isPending}
        fallback={<LoadingState label="Loading servers" style={styles.loading} />}
      >
        <div sx={styles.list}>
          <Show
            when={!servers.isError}
            fallback={
              <p sx={styles.empty}>
                Servers could not be loaded.{" "}
                <button type="button" sx={styles.retry} onClick={() => void servers.refetch()}>
                  Try again
                </button>
              </p>
            }
          >
            <For
              each={servers.data ?? []}
              fallback={<p sx={styles.empty}>No servers are registered to your account yet.</p>}
            >
              {(server) => (
                <div sx={styles.row}>
                  <span sx={styles.icon} aria-hidden="true">
                    <IconTablerServer {...stylex.attrs(styles.iconSvg)} />
                  </span>
                  <div sx={styles.body}>
                    <p sx={styles.name}>MacroGraph server</p>
                    <p sx={styles.id}>{server.id}</p>
                  </div>
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
  body: { minWidth: 0 },
  name: { margin: 0, fontSize: 15, lineHeight: "20px", fontWeight: 500 },
  id: {
    margin: 0,
    marginTop: 2,
    overflow: "hidden",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
