import type { JSX } from "@solidjs/web";

import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createQuery } from "@tanstack/solid-query";
import { createMemo, For, Show } from "solid-js";

import { gateway, gatewayKeys, useGatewayAccess } from "../../gatewayApi";
import { Header } from "../../Header";
import { RequireSession } from "../../session";

const tabs = [
  { href: "/gateway", label: "Overview" },
  { href: "/gateway/tools", label: "Tools" },
  { href: "/gateway/approvals", label: "Approvals" },
  { href: "/gateway/events", label: "Events" },
  { href: "/gateway/webhooks", label: "Webhooks" },
] as const;

/** MacroGraph Gateway: connected accounts behind one API, MCP server, and event listener. */
export function GatewayLayout(props: { readonly children?: JSX.Element }) {
  return (
    <div sx={styles.page}>
      <Header />
      <div sx={styles.container}>
        <RequireSession>{() => <GatewayContent>{props.children}</GatewayContent>}</RequireSession>
      </div>
    </div>
  );
}

function GatewayContent(props: { readonly children?: JSX.Element }) {
  const location = useLocation();
  const access = useGatewayAccess();
  return (
    <Show
      when={!access.isPending}
      fallback={<LoadingState label="Loading MacroGraph Gateway" style={styles.loading} />}
    >
      <Show
        when={access.data?.enabled === true}
        fallback={
          <p sx={styles.unavailable}>MacroGraph Gateway isn't available for your account yet.</p>
        }
      >
        <header sx={styles.intro}>
          <p sx={styles.eyebrow}>MacroGraph Gateway</p>
          <h1 sx={styles.title}>Your accounts, one endpoint</h1>
          <p sx={styles.subtitle}>
            Call your connected accounts' APIs through MacroGraph without handing out tokens, and
            let MacroGraph stay subscribed to their events for you.
          </p>
        </header>
        <nav sx={styles.tabs} aria-label="Gateway">
          <For each={tabs}>
            {(tab) => (
              <a
                href={tab.href}
                aria-current={location.pathname === tab.href ? "page" : undefined}
                sx={[styles.tab, location.pathname === tab.href && styles.activeTab]}
              >
                {tab.label}
                <Show when={tab.href === "/gateway/approvals"}>
                  <PendingCount />
                </Show>
              </a>
            )}
          </For>
        </nav>
        {props.children}
      </Show>
    </Show>
  );
}

function PendingCount() {
  const approvals = createQuery(() => ({
    queryKey: gatewayKeys.approvals,
    queryFn: gateway.approvals,
    refetchInterval: 5_000,
  }));
  const pending = createMemo(
    () => (approvals.data ?? []).filter((approval) => approval.status === "pending").length,
  );
  return (
    <Show when={pending() > 0}>
      <span sx={styles.count} aria-label={`${pending()} waiting`}>
        {pending()}
      </span>
    </Show>
  );
}

const narrow = "@media (max-width: 639px)";
const styles = stylex.create({
  page: { minHeight: "100dvh", backgroundColor: colors.gray1, color: colors.gray12 },
  container: {
    width: "100%",
    maxWidth: 880,
    boxSizing: "border-box",
    marginInline: "auto",
    paddingInline: { default: 24, [narrow]: 0 },
    paddingTop: { default: 32, [narrow]: 16 },
    paddingBottom: 64,
  },
  loading: { height: 240 },
  unavailable: { margin: 0, padding: 24, fontSize: 14, color: colors.gray10 },
  intro: { paddingInline: { default: 0, [narrow]: 16 }, marginBottom: 20 },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: colors.gray10,
  },
  title: { margin: 0, marginTop: 6, fontSize: 24, lineHeight: "32px", fontWeight: 600 },
  subtitle: {
    margin: 0,
    marginTop: 6,
    maxWidth: 620,
    fontSize: 14,
    lineHeight: "21px",
    color: colors.gray11,
  },
  tabs: {
    display: "flex",
    gap: 4,
    overflowX: "auto",
    marginBottom: { default: 32, [narrow]: 24 },
    paddingInline: { default: 0, [narrow]: 4 },
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
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
  count: {
    minWidth: 18,
    paddingInline: 5,
    boxSizing: "border-box",
    borderRadius: 999,
    backgroundColor: "#eab308",
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "18px",
    textAlign: "center",
    color: "#111",
  },
});
