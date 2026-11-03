import { Button, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { createMemo, For, Show } from "solid-js";

import { gateway, type GatewayApproval, gatewayKeys } from "../../gatewayApi";
import { showToast } from "../../Toasts";
import { Section, styles, time } from "./shared";

const statusLabels: Record<GatewayApproval["status"], string> = {
  pending: "Waiting",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  denied: "Denied",
  expired: "Expired",
};

const accountName = (account: GatewayApproval["account"]) => account.displayName ?? account.id;

/** Calls waiting for the user's decision, and what happened to recent ones. */
export function GatewayApprovalsRoute() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const approvals = createQuery(() => ({
    queryKey: gatewayKeys.approvals,
    queryFn: gateway.approvals,
    refetchInterval: 3_000,
  }));
  const tools = createQuery(() => ({ queryKey: gatewayKeys.tools, queryFn: gateway.tools }));
  const pending = createMemo(() =>
    (approvals.data ?? []).filter((approval) => approval.status === "pending"),
  );
  const history = createMemo(() =>
    (approvals.data ?? []).filter((approval) => approval.status !== "pending"),
  );
  const highlighted = createMemo(() => new URLSearchParams(location.search).get("approval"));
  const providerName = (id: string) =>
    tools.data?.providers.find((provider) => provider.id === id)?.displayName ?? id;

  const decide = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: gateway.decide,
    onSuccess: (approval) => {
      void queryClient.invalidateQueries({ queryKey: gatewayKeys.approvals });
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
      void queryClient.invalidateQueries({ queryKey: gatewayKeys.approvals });
      showToast({ tone: "error", content: "That request has already been decided or expired." });
    },
  }));

  return (
    <Show
      when={!approvals.isPending}
      fallback={<LoadingState label="Loading approvals" style={styles.loading} />}
    >
      <div sx={styles.page}>
        <Section
          title="Waiting for approval"
          description="Approving runs the call with exactly these arguments."
        >
          <div sx={styles.list}>
            <For each={pending()} fallback={<p sx={styles.empty}>Nothing is waiting for you.</p>}>
              {(approval) => (
                <div
                  sx={[local.approval, highlighted() === approval.id && local.highlighted]}
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
                    <pre sx={local.arguments}>{JSON.stringify(approval.arguments, null, 2)}</pre>
                  </div>
                  <div sx={local.actions}>
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
        </Section>

        <Show when={history().length > 0}>
          <Section title="Recent">
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
                        styles.badge,
                        approval.status === "succeeded" &&
                          (approval.result?.status ?? 0) < 400 &&
                          styles.badgeGood,
                        (approval.status === "failed" ||
                          (approval.result !== null && approval.result.status >= 400)) &&
                          styles.badgeBad,
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
          </Section>
        </Show>
      </div>
    </Show>
  );
}

const narrow = "@media (max-width: 639px)";
const local = stylex.create({
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
});
