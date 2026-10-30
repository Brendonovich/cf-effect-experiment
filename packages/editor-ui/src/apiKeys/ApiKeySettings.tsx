import * as stylex from "@stylexjs/stylex";
import { QueryClient, useMutation } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";

/** An API key as listed to managers; the secret is never available after creation. */
export interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface CreatedApiKey extends ApiKeySummary {
  readonly key: string;
}

export interface ApiKeyClient {
  readonly list: () => Promise<ReadonlyArray<ApiKeySummary>>;
  readonly create: (name: string) => Promise<CreatedApiKey>;
  readonly revoke: (id: string) => Promise<void>;
}

export interface ApiKeySettingsProps {
  /** `null` when the current user cannot manage keys. */
  readonly client: ApiKeyClient | null;
  readonly mcpUrl: string;
  readonly restUrl: string;
  /** The server name MCP clients show, used as the key of the config snippet. */
  readonly serverName?: string;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : "The API key operation failed";

const formatDate = (value: string | null) =>
  value === null
    ? "Never"
    : new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ApiKeySettings(props: ApiKeySettingsProps) {
  const [keys, setKeys] = createSignal<ReadonlyArray<ApiKeySummary> | undefined>();
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [created, setCreated] = createSignal<CreatedApiKey | null>(null);
  const [copied, setCopied] = createSignal<string | null>(null);

  const queryClient = new QueryClient({
    defaultOptions: { mutations: { networkMode: "always", retry: false } },
  });
  onCleanup(() => queryClient.clear());

  createEffect(
    () => props.client,
    (client) => {
      setKeys(undefined);
      setLoadError(null);
      if (client === null) return;
      let active = true;
      client.list().then(
        (next) => {
          if (active) setKeys(next);
        },
        (error: unknown) => {
          if (active) setLoadError(message(error));
        },
      );
      return () => {
        active = false;
      };
    },
  );

  const createMutation = useMutation(
    () => ({
      mutationFn: async (keyName: string) => {
        const client = props.client;
        if (client === null) throw new Error("You cannot manage API keys");
        return client.create(keyName);
      },
      onSuccess: (key: CreatedApiKey) => {
        setCreated(key);
        setName("");
        setKeys((current) => [...(current ?? []), key]);
      },
    }),
    () => queryClient,
  );
  const revokeMutation = useMutation(
    () => ({
      mutationFn: async (id: string) => {
        const client = props.client;
        if (client === null) throw new Error("You cannot manage API keys");
        await client.revoke(id);
        return id;
      },
      onSuccess: (id: string) => {
        setKeys((current) => current?.filter((key) => key.id !== id));
        if (created()?.id === id) setCreated(null);
      },
    }),
    () => queryClient,
  );

  const serverName = createMemo(() => props.serverName ?? "macrograph");
  const snippet = createMemo(() =>
    JSON.stringify(
      {
        mcpServers: {
          [serverName()]: {
            type: "http",
            url: props.mcpUrl,
            headers: { Authorization: `Bearer ${created()?.key ?? "<your API key>"}` },
          },
        },
      },
      null,
      2,
    ),
  );
  const mutationError = createMemo(() => {
    const error = createMutation.error ?? revokeMutation.error;
    return error === null ? null : message(error);
  });

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  };

  const CopyButton = (copyProps: {
    readonly id: string;
    readonly label: string;
    readonly value: () => string;
  }) => (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      aria-label={`Copy ${copyProps.label}`}
      onClick={() => void copy(copyProps.id, copyProps.value())}
    >
      {copied() === copyProps.id ? "Copied" : "Copy"}
    </Button>
  );

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const keyName = name().trim();
    if (keyName.length > 0 && !createMutation.isPending) createMutation.mutate(keyName);
  };

  return (
    <section sx={styles.section} aria-labelledby="api-keys-heading">
      <h3 id="api-keys-heading" sx={styles.heading}>
        API keys
      </h3>
      <p sx={styles.description}>
        Scripts and AI agents can read and edit this project through the REST API and MCP. A key
        acts as the person who created it, and its edits appear to everyone in the editor.
      </p>

      <div sx={styles.endpoints}>
        <label sx={styles.label} for="api-keys-mcp-url">
          MCP endpoint
        </label>
        <div sx={styles.row}>
          <input id="api-keys-mcp-url" sx={styles.input} readonly value={props.mcpUrl} />
          <CopyButton id="mcp-url" label="MCP endpoint" value={() => props.mcpUrl} />
        </div>
        <label sx={styles.label} for="api-keys-rest-url">
          REST API
        </label>
        <div sx={styles.row}>
          <input id="api-keys-rest-url" sx={styles.input} readonly value={props.restUrl} />
          <CopyButton id="rest-url" label="REST API URL" value={() => props.restUrl} />
        </div>
        <div sx={styles.snippetHeader}>
          <span sx={styles.label}>MCP client configuration</span>
          <CopyButton id="snippet" label="MCP client configuration" value={snippet} />
        </div>
        <pre sx={styles.snippet} data-api-key-snippet>
          {snippet()}
        </pre>
        <p sx={styles.hint}>
          Send the key as <code>Authorization: Bearer &lt;key&gt;</code> on every request.
        </p>
      </div>

      <Show
        when={props.client !== null}
        fallback={
          <p sx={styles.status}>Only the server owner and admins can create and revoke API keys.</p>
        }
      >
        <Show when={created()}>
          {(key) => (
            <div sx={styles.created} role="status" data-api-key-created>
              <p sx={styles.createdTitle}>Copy “{key().name}” now. It won’t be shown again.</p>
              <div sx={styles.row}>
                <input
                  sx={styles.input}
                  readonly
                  value={key().key}
                  aria-label="New API key"
                  data-api-key-secret
                />
                <CopyButton id="secret" label="API key" value={() => key().key} />
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </Show>

        <form sx={styles.form} onSubmit={submit}>
          <input
            sx={styles.input}
            placeholder="Key name, such as CI or Claude Desktop"
            aria-label="API key name"
            maxlength={100}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <Button type="submit" size="sm" disabled={createMutation.isPending || !name().trim()}>
            {createMutation.isPending ? "Creating..." : "Create key"}
          </Button>
        </form>

        <Show when={mutationError() ?? loadError()}>
          {(error) => (
            <p sx={styles.error} role="alert">
              {error()}
            </p>
          )}
        </Show>

        <Show when={keys()} fallback={<p sx={styles.status}>Loading API keys...</p>}>
          {(list) => (
            <Show when={list().length > 0} fallback={<p sx={styles.status}>No API keys yet.</p>}>
              <table sx={styles.table} aria-label="API keys">
                <thead>
                  <tr>
                    <th sx={styles.th}>Name</th>
                    <th sx={styles.th}>Created by</th>
                    <th sx={styles.th}>Created</th>
                    <th sx={styles.th}>Last used</th>
                    <th sx={styles.th}>
                      <span sx={styles.visuallyHidden}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={list()} keyed={(key) => key.id}>
                    {(key) => (
                      <tr data-api-key-row={key().id}>
                        <td sx={styles.td}>{key().name}</td>
                        <td sx={styles.td}>{key().email ?? "Unknown"}</td>
                        <td sx={styles.td}>{formatDate(key().createdAt)}</td>
                        <td sx={styles.td}>{formatDate(key().lastUsedAt)}</td>
                        <td sx={[styles.td, styles.actions]}>
                          <button
                            type="button"
                            sx={styles.revoke}
                            disabled={revokeMutation.isPending}
                            aria-label={`Revoke ${key().name}`}
                            onClick={() => revokeMutation.mutate(key().id)}
                          >
                            {revokeMutation.isPending && revokeMutation.variables === key().id
                              ? "Revoking..."
                              : "Revoke"}
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          )}
        </Show>
      </Show>
    </section>
  );
}

const styles = stylex.create({
  section: { boxSizing: "border-box", width: "100%", maxWidth: 672, padding: 12, fontSize: 14 },
  heading: { margin: 0, fontWeight: 500, color: colors.gray12 },
  description: {
    marginBottom: 0,
    marginTop: 4,
    fontSize: 12,
    lineHeight: "20px",
    color: colors.gray11,
  },
  endpoints: { display: "flex", flexDirection: "column", gap: 6, marginTop: 16 },
  label: { fontSize: 11, fontWeight: 500, color: colors.gray12 },
  row: { display: "flex", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 24,
    boxSizing: "border-box",
    borderColor: colors.gray6,
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray1,
    color: colors.gray12,
    fontFamily: "inherit",
    fontSize: 12,
    paddingInline: 8,
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  snippetHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  snippet: {
    margin: 0,
    overflowX: "auto",
    borderColor: colors.gray4,
    borderRadius: 6,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray1,
    color: colors.gray11,
    fontSize: 11,
    lineHeight: "16px",
    padding: 10,
  },
  hint: { margin: 0, fontSize: 11, color: colors.gray10 },
  created: {
    marginTop: 16,
    borderLeftColor: "#3e9b4f",
    borderLeftStyle: "solid",
    borderLeftWidth: 2,
    paddingLeft: 12,
  },
  createdTitle: { marginBottom: 8, marginTop: 0, fontSize: 12, color: colors.gray12 },
  form: { display: "flex", alignItems: "center", gap: 8, marginTop: 16 },
  status: { marginBottom: 0, marginTop: 12, fontSize: 12, color: colors.gray11 },
  error: { marginBottom: 0, marginTop: 12, fontSize: 12, color: colors.red10 },
  table: { width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 12 },
  th: {
    textAlign: "left",
    fontWeight: 500,
    color: colors.gray10,
    paddingBlock: 4,
    paddingInline: 6,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  td: {
    color: colors.gray12,
    paddingBlock: 6,
    paddingInline: 6,
    borderBottomColor: colors.gray3,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    overflowWrap: "anywhere",
  },
  actions: { textAlign: "right" },
  revoke: {
    border: 0,
    borderRadius: 2,
    paddingBlock: 4,
    paddingInline: 8,
    fontSize: 12,
    color: colors.red10,
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    backgroundColor: { default: "transparent", ":hover": colors.red3 },
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
