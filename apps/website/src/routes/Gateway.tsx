import { Button, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import { getRequestEvent, isServer } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { createMemo, For, Show } from "solid-js";

import {
  decideGatewayApproval,
  gatewayAccessKey,
  getGatewayAccess,
  type GatewayApproval,
  type GatewayPolicy,
  type GatewayTool,
  gatewayApprovalsKey,
  gatewayMcpPath,
  gatewayToolsKey,
  getGatewayApprovals,
  getGatewayTools,
  setGatewayPolicy,
} from "../api";
import { showToast } from "../Toasts";

const policies: ReadonlyArray<{ readonly value: GatewayPolicy; readonly label: string }> = [
  { value: "allow", label: "Allow" },
  { value: "approve", label: "Ask" },
];

const statusLabels: Record<GatewayApproval["status"], string> = {
  pending: "Waiting",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  denied: "Denied",
  expired: "Expired",
};

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const origin = () =>
  isServer
    ? new URL(getRequestEvent()?.request.url ?? "https://macrograph.app").origin
    : location.origin;

const accountName = (account: GatewayApproval["account"]) => account.displayName ?? account.id;

/** Allow or Ask for one tool. */
function PolicyControl(props: {
  readonly tool: GatewayTool;
  readonly disabled: boolean;
  readonly onChange: (policy: GatewayPolicy) => void;
}) {
  return (
    <div sx={styles.policies} role="group" aria-label={`${props.tool.title} policy`}>
      <For each={policies}>
        {(option) => (
          <button
            type="button"
            aria-pressed={props.tool.policy === option.value ? "true" : "false"}
            sx={[styles.policy, props.tool.policy === option.value && styles.policySelected]}
            disabled={props.disabled}
            onClick={() => {
              if (props.tool.policy !== option.value) props.onChange(option.value);
            }}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

/** The gateway page, for accounts it is enabled for. */
export function GatewayRoute() {
  const access = createQuery(() => ({ queryKey: gatewayAccessKey, queryFn: getGatewayAccess }));
  return (
    <Show
      when={!access.isPending}
      fallback={<LoadingState label="Loading" style={styles.loading} />}
    >
      <Show
        when={access.data?.enabled === true}
        fallback={<p sx={styles.empty}>This page isn't available for your account.</p>}
      >
        <GatewayDashboard />
      </Show>
    </Show>
  );
}

/** Tools agents can call as the user's connected accounts, and the calls awaiting approval. */
function GatewayDashboard() {
  const queryClient = useQueryClient();
  const routeLocation = useLocation();
  const tools = createQuery(() => ({ queryKey: gatewayToolsKey, queryFn: getGatewayTools }));
  const approvals = createQuery(() => ({
    queryKey: gatewayApprovalsKey,
    queryFn: getGatewayApprovals,
    refetchInterval: 3_000,
  }));
  const pending = createMemo(() =>
    (approvals.data ?? []).filter((approval) => approval.status === "pending"),
  );
  const history = createMemo(() =>
    (approvals.data ?? []).filter((approval) => approval.status !== "pending").slice(0, 10),
  );
  const highlighted = createMemo(() => new URLSearchParams(routeLocation.search).get("approval"));
  const providerName = (id: string) =>
    tools.data?.providers.find((provider) => provider.id === id)?.displayName ?? id;
  const mcpUrl = createMemo(() => `${origin()}${gatewayMcpPath}`);

  const setPolicy = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: setGatewayPolicy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gatewayToolsKey }),
    onError: () =>
      showToast({ tone: "error", content: "Could not change the tool. Please try again." }),
  }));

  const updating = (tool: string) => setPolicy.isPending && setPolicy.variables?.tool === tool;

  const decide = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: decideGatewayApproval,
    onSuccess: (approval) => {
      void queryClient.invalidateQueries({ queryKey: gatewayApprovalsKey });
      showToast({
        tone: approval.status === "failed" ? "error" : "success",
        content:
          approval.status === "denied"
            ? `Denied ${approval.title}`
            : approval.status === "failed"
              ? `${approval.title} failed: ${approval.error ?? "unknown error"}`
              : `Ran ${approval.title}`,
      });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: gatewayApprovalsKey });
      showToast({ tone: "error", content: "That request has already been decided or expired." });
    },
  }));

  return (
    <div sx={styles.root}>
      <header sx={styles.header}>
        <h1 sx={styles.title}>Gateway</h1>
        <p sx={styles.subtitle}>
          Give AI agents one MCP server for your connected accounts. They never see your tokens, and
          each tool either runs immediately or waits for your approval.
        </p>
        <div sx={styles.endpoint}>
          <code sx={styles.endpointUrl}>{mcpUrl()}</code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            sx={styles.copy}
            onClick={() =>
              void navigator.clipboard
                .writeText(mcpUrl())
                .then(() => showToast({ tone: "success", content: "Copied the MCP URL" }))
            }
          >
            Copy
          </Button>
        </div>
      </header>

      <Show when={pending().length > 0}>
        <section sx={styles.section} aria-label="Waiting for approval">
          <h2 sx={styles.sectionTitle}>Waiting for approval</h2>
          <div sx={styles.list}>
            <For each={pending()}>
              {(approval) => (
                <div
                  sx={[styles.approval, highlighted() === approval.id && styles.highlighted]}
                  data-approval={approval.id}
                >
                  <div sx={styles.body}>
                    <p sx={styles.name}>
                      {approval.caller ?? "An agent"} wants to <strong>{approval.title}</strong>
                    </p>
                    <p sx={styles.detail}>
                      As {accountName(approval.account)} on {providerName(approval.provider)} ·
                      Expires {time.format(new Date(approval.expiresAt))}
                    </p>
                    <pre sx={styles.arguments}>{JSON.stringify(approval.arguments, null, 2)}</pre>
                  </div>
                  <div sx={styles.actions}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={decide.isPending && decide.variables?.id === approval.id}
                      onClick={() => decide.mutate({ id: approval.id, decision: "deny" })}
                    >
                      Deny
                    </Button>
                    <Button
                      type="button"
                      disabled={decide.isPending && decide.variables?.id === approval.id}
                      onClick={() => decide.mutate({ id: approval.id, decision: "approve" })}
                    >
                      {decide.isPending &&
                      decide.variables?.id === approval.id &&
                      decide.variables.decision === "approve"
                        ? "Running..."
                        : "Approve"}
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show
        when={!tools.isPending}
        fallback={<LoadingState label="Loading tools" style={styles.loading} />}
      >
        <Show
          when={!tools.isError}
          fallback={
            <p sx={styles.empty}>
              Tools could not be loaded.{" "}
              <button type="button" sx={styles.retry} onClick={() => void tools.refetch()}>
                Try again
              </button>
            </p>
          }
        >
          <For each={tools.data?.providers ?? []}>
            {(provider) => (
              <section sx={styles.section} aria-label={provider.displayName}>
                <div sx={styles.sectionHeader}>
                  <h2 sx={styles.sectionTitle}>{provider.displayName}</h2>
                  <Show
                    when={provider.accounts.length > 0}
                    fallback={
                      <a href="/account/credentials" sx={styles.connect}>
                        Not connected
                      </a>
                    }
                  >
                    <span sx={styles.accounts}>
                      As{" "}
                      {provider.accounts
                        .map((account) => account.displayName ?? account.id)
                        .join(", ")}
                    </span>
                  </Show>
                </div>
                <div sx={[styles.list, provider.accounts.length === 0 && styles.disconnected]}>
                  <For each={provider.tools}>
                    {(tool) => (
                      <div sx={styles.row} data-tool={tool.name}>
                        <span sx={[styles.method, tool.readOnly && styles.readMethod]}>
                          {tool.method}
                        </span>
                        <div sx={styles.body}>
                          <p sx={styles.name}>{tool.title}</p>
                          <p sx={styles.detail} title={tool.description}>
                            {tool.description}
                          </p>
                        </div>
                        <PolicyControl
                          tool={tool}
                          disabled={updating(tool.name)}
                          onChange={(policy) => setPolicy.mutate({ tool: tool.name, policy })}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </Show>

      <Show when={history().length > 0}>
        <section sx={styles.section} aria-label="Recent approvals">
          <h2 sx={styles.sectionTitle}>Recent approvals</h2>
          <div sx={styles.list}>
            <For each={history()}>
              {(approval) => (
                <div sx={styles.row}>
                  <div sx={styles.body}>
                    <p sx={styles.name}>{approval.title}</p>
                    <p sx={styles.detail}>
                      {approval.caller ?? "An agent"} · As {accountName(approval.account)} on{" "}
                      {providerName(approval.provider)} ·{" "}
                      {time.format(new Date(approval.createdAt))}
                      {approval.error === null ? "" : ` · ${approval.error}`}
                    </p>
                  </div>
                  <span
                    sx={[
                      styles.status,
                      (approval.status === "failed" ||
                        (approval.result !== null && approval.result.status >= 400)) &&
                        styles.statusError,
                    ]}
                  >
                    {approval.result !== null && approval.result.status >= 400
                      ? `HTTP ${approval.result.status}`
                      : statusLabels[approval.status]}
                  </span>
                </div>
              )}
            </For>
          </div>
        </section>
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
  endpoint: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingBlock: 6,
    paddingInlineStart: 12,
    paddingInlineEnd: 6,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray2,
  },
  endpointUrl: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontSize: 13,
    color: colors.gray12,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  copy: { borderRadius: 6 },
  loading: { height: 160 },
  policies: {
    display: "flex",
    flexShrink: 0,
    padding: 2,
    borderRadius: 7,
    backgroundColor: colors.gray4,
  },
  policy: {
    paddingBlock: 4,
    paddingInline: 10,
    border: 0,
    borderRadius: 5,
    backgroundColor: "transparent",
    fontSize: 12,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    cursor: { default: "pointer", ":disabled": "progress" },
  },
  policySelected: { backgroundColor: colors.gray1, color: colors.gray12 },
  section: { display: "flex", flexDirection: "column", gap: 10 },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingInline: { default: 0, [narrow]: 16 },
  },
  sectionTitle: {
    margin: 0,
    paddingInline: { default: 0, [narrow]: 16 },
    fontSize: 14,
    fontWeight: 500,
    color: colors.gray12,
  },
  accounts: { fontSize: 13, color: colors.gray10 },
  connect: { fontSize: 13, color: colors.gray10, textDecoration: "underline" },
  list: {
    overflow: "hidden",
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderInlineWidth: { default: 1, [narrow]: 0 },
    borderRadius: { default: 8, [narrow]: 0 },
    backgroundColor: colors.gray2,
  },
  disconnected: { opacity: 0.6 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBlock: 10,
    paddingInline: 16,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  approval: {
    display: "flex",
    flexDirection: { default: "row", [narrow]: "column" },
    alignItems: { default: "flex-start", [narrow]: "stretch" },
    gap: 12,
    padding: 16,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  highlighted: { backgroundColor: colors.gray3 },
  body: { flex: 1, minWidth: 0 },
  name: { margin: 0, fontSize: 14, lineHeight: "20px", fontWeight: 500 },
  detail: {
    margin: 0,
    marginTop: 2,
    overflow: "hidden",
    fontSize: 13,
    color: colors.gray10,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  arguments: {
    margin: 0,
    marginTop: 10,
    padding: 10,
    maxHeight: 240,
    overflow: "auto",
    borderRadius: 6,
    backgroundColor: colors.gray1,
    fontSize: 12,
    lineHeight: "18px",
    color: colors.gray11,
  },
  actions: { display: "flex", gap: 8, flexShrink: 0, justifyContent: "flex-end" },
  method: {
    flexShrink: 0,
    width: 52,
    paddingBlock: 2,
    borderRadius: 4,
    backgroundColor: colors.gray4,
    fontSize: 11,
    fontWeight: 600,
    textAlign: "center",
    color: colors.gray12,
  },
  readMethod: { color: colors.gray10 },
  status: { flexShrink: 0, fontSize: 12, color: colors.gray10 },
  statusError: { color: colors.red11 },
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
