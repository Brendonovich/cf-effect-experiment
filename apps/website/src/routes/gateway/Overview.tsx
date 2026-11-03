import { Button, LoadingState } from "@macrograph/editor-ui";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";

import { gateway, gatewayKeys, gatewayPaths } from "../../gatewayApi";
import { showToast } from "../../Toasts";
import { CopyField, Section, siteOrigin, styles, time } from "./shared";

export function GatewayOverviewRoute() {
  const apiUrl = createMemo(() => `${siteOrigin()}${gatewayPaths.api}`);
  const mcpUrl = createMemo(() => `${siteOrigin()}${gatewayPaths.mcp}`);
  const tools = createQuery(() => ({ queryKey: gatewayKeys.tools, queryFn: gateway.tools }));
  const connected = createMemo(() =>
    (tools.data?.providers ?? []).flatMap((provider) =>
      provider.accounts.map((account) => ({
        provider: provider.displayName,
        name: account.displayName ?? account.id,
      })),
    ),
  );

  return (
    <div sx={styles.page}>
      <Section
        title="Endpoints"
        description="Point agents at the MCP server, or call the HTTP API from your own code."
      >
        <div sx={[styles.callout]}>
          <CopyField
            label="MCP server"
            value={mcpUrl()}
            description="Clients that support MCP OAuth sign in with your MacroGraph account; others can send an API key as a bearer token."
          />
          <CopyField
            label="HTTP API"
            value={apiUrl()}
            description="Send an API key in the Authorization header: Bearer mgw_…"
          />
        </div>
      </Section>

      <Section
        title="Connected accounts"
        description={
          <>
            Gateway calls and events use the accounts on your{" "}
            <a href="/account/credentials" sx={styles.link}>
              credentials
            </a>{" "}
            page.
          </>
        }
      >
        <div sx={styles.list}>
          <For
            each={connected()}
            fallback={<p sx={styles.empty}>Connect a Twitch or GitHub account to get started.</p>}
          >
            {(account) => (
              <div sx={styles.row}>
                <div sx={styles.body}>
                  <p sx={styles.name}>{account.name}</p>
                  <p sx={styles.detail}>{account.provider}</p>
                </div>
              </div>
            )}
          </For>
        </div>
      </Section>

      <ApiKeys />

      <Section title="Quick start">
        <pre sx={styles.code}>
          {`# List the tools your accounts can call
curl ${apiUrl()}/tools -H "Authorization: Bearer $MACROGRAPH_GATEWAY_KEY"

# Call one; tools set to Ask answer 202 with an approval to wait on
curl -X POST "${apiUrl()}/tools/twitch_get_chatters?wait=25" \\
  -H "Authorization: Bearer $MACROGRAPH_GATEWAY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"arguments": {}}'

# Stream events as they arrive (server-sent events; resume with ?after=<seq>)
curl -N ${apiUrl()}/events/stream -H "Authorization: Bearer $MACROGRAPH_GATEWAY_KEY"

# Or page through recent events
curl "${apiUrl()}/events?after=0&limit=100" -H "Authorization: Bearer $MACROGRAPH_GATEWAY_KEY"`}
        </pre>
      </Section>
    </div>
  );
}

function ApiKeys() {
  const queryClient = useQueryClient();
  const keys = createQuery(() => ({ queryKey: gatewayKeys.keys, queryFn: gateway.keys }));
  const [name, setName] = createSignal("");
  const [created, setCreated] = createSignal<{ readonly name: string; readonly key: string }>();

  const create = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: gateway.createKey,
    onSuccess: (key) => {
      setCreated({ name: key.name, key: key.key });
      setName("");
      void queryClient.invalidateQueries({ queryKey: gatewayKeys.keys });
    },
    onError: (error) => showToast({ tone: "error", content: error.message }),
  }));

  const revoke = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: gateway.revokeKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gatewayKeys.keys }),
    onError: () => showToast({ tone: "error", content: "Could not revoke the key." }),
  }));

  return (
    <Section
      title="API keys"
      description="Keys call tools and read events as you. They can't change your tool settings or approve calls."
    >
      <Show when={created()}>
        {(current) => (
          <div sx={styles.callout}>
            <CopyField
              label={`New key: ${current().name}`}
              value={current().key}
              description="Copy it now. It won't be shown again."
            />
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                sx={styles.button}
                onClick={() => setCreated(undefined)}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </Show>
      <form
        sx={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (name().trim() !== "") create.mutate(name().trim());
        }}
      >
        <input
          sx={styles.input}
          placeholder="Key name, e.g. Stream bot"
          aria-label="Key name"
          value={name()}
          maxlength={100}
          onInput={(event) => {
            setName(event.currentTarget.value);
          }}
        />
        <Button
          type="submit"
          size="sm"
          sx={styles.button}
          disabled={create.isPending || name().trim() === ""}
        >
          {create.isPending ? "Creating..." : "Create key"}
        </Button>
      </form>
      <Show
        when={!keys.isPending}
        fallback={<LoadingState label="Loading keys" style={styles.loading} />}
      >
        <div sx={styles.list}>
          <For each={keys.data?.keys ?? []} fallback={<p sx={styles.empty}>No API keys yet.</p>}>
            {(key) => (
              <div sx={styles.row} data-key={key.id}>
                <div sx={styles.body}>
                  <p sx={styles.name}>{key.name}</p>
                  <p sx={styles.detail}>
                    Created {time.format(new Date(key.createdAt))} ·{" "}
                    {key.lastUsedAt === null
                      ? "Never used"
                      : `Last used ${time.format(new Date(key.lastUsedAt))}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  sx={styles.button}
                  disabled={revoke.isPending && revoke.variables === key.id}
                  onClick={() => {
                    if (window.confirm(`Revoke ${key.name}? Anything using it stops working.`))
                      revoke.mutate(key.id);
                  }}
                >
                  Revoke
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Section>
  );
}
