import type { JSX } from "@solidjs/web";

import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { Header } from "../Header";
import { RequireSession } from "../session";

const tabs = [
  { href: "/account/credentials", label: "Credentials" },
  { href: "/account/servers", label: "Servers" },
];

export function AccountLayout(props: { readonly children?: JSX.Element }) {
  const location = useLocation();
  return (
    <div sx={styles.page}>
      <Header />
      <div sx={styles.container}>
        <nav sx={styles.tabs} aria-label="Account">
          <For each={tabs}>
            {(tab) => (
              <a
                href={tab.href}
                aria-current={location.pathname === tab.href ? "page" : undefined}
                sx={[styles.tab, location.pathname === tab.href && styles.activeTab]}
              >
                {tab.label}
              </a>
            )}
          </For>
        </nav>
        <RequireSession>{() => props.children}</RequireSession>
      </div>
    </div>
  );
}

const styles = stylex.create({
  page: { minHeight: "100dvh", backgroundColor: colors.gray1, color: colors.gray12 },
  container: {
    width: "100%",
    maxWidth: 800,
    boxSizing: "border-box",
    marginInline: "auto",
    paddingInline: 24,
    paddingTop: 24,
    paddingBottom: 64,
  },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 32,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  tab: {
    marginBottom: -1,
    paddingBlock: 10,
    paddingInline: 12,
    borderBottomColor: "transparent",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    fontSize: 14,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    textDecoration: "none",
  },
  activeTab: { borderBottomColor: colors.gray12, color: colors.gray12 },
});
