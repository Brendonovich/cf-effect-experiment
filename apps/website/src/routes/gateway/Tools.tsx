import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";

import { gateway, gatewayKeys, type GatewayPolicy, type GatewayTool } from "../../gatewayApi";
import { showToast } from "../../Toasts";
import { Section, styles } from "./shared";

const policies: ReadonlyArray<{ readonly value: GatewayPolicy; readonly label: string }> = [
  { value: "allow", label: "Allow" },
  { value: "approve", label: "Ask" },
];

/** Allow or Ask for one tool. */
function PolicyControl(props: {
  readonly tool: GatewayTool;
  readonly disabled: boolean;
  readonly onChange: (policy: GatewayPolicy) => void;
}) {
  return (
    <div sx={local.policies} role="group" aria-label={`${props.tool.title} policy`}>
      <For each={policies}>
        {(option) => (
          <button
            type="button"
            aria-pressed={props.tool.policy === option.value ? "true" : "false"}
            sx={[local.policy, props.tool.policy === option.value && local.policySelected]}
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

/** Every operation agents can call, and whether it runs immediately or asks first. */
export function GatewayToolsRoute() {
  const queryClient = useQueryClient();
  const tools = createQuery(() => ({ queryKey: gatewayKeys.tools, queryFn: gateway.tools }));
  const setPolicy = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: gateway.setPolicy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gatewayKeys.tools }),
    onError: () =>
      showToast({ tone: "error", content: "Could not change the tool. Please try again." }),
  }));
  const updating = (tool: string) => setPolicy.isPending && setPolicy.variables?.tool === tool;

  return (
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
        <div sx={styles.page}>
          <For each={tools.data?.providers ?? []}>
            {(provider) => (
              <Section
                title={provider.displayName}
                description={
                  provider.accounts.length > 0 ? (
                    `As ${provider.accounts.map((account) => account.displayName ?? account.id).join(", ")}`
                  ) : (
                    <a href="/account/credentials" sx={styles.link}>
                      Connect an account
                    </a>
                  )
                }
              >
                <div sx={[styles.list, provider.accounts.length === 0 && local.disconnected]}>
                  <For each={provider.tools}>
                    {(tool) => (
                      <div sx={styles.row} data-tool={tool.name}>
                        <span sx={[local.method, tool.readOnly && local.readMethod]}>
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
              </Section>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}

const local = stylex.create({
  disconnected: { opacity: 0.6 },
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
});
