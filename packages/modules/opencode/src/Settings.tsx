import type { RpcClient, RpcClientError, RpcGroup } from "effect/rpc";

import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Cause, Effect, Exit } from "effect";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from "solid-js";

import {
  ClientRpcs,
  ClientState,
  type ConnectionId,
  type ConnectionState,
  type ConnectionType,
  OAuthAttempt,
  initialClientState,
} from "./Definition.ts";
import module from "./Module.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  toolbar: { alignItems: "center", display: "flex", gap: 8 },
  picker: { flex: 1, minWidth: 0 },
  section: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
  },
  heading: { alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" },
  title: { fontSize: 13, fontWeight: 600, margin: 0 },
  label: { color: colors.gray11, display: "flex", flexDirection: "column", fontSize: 12, gap: 4 },
  input: {
    backgroundColor: colors.gray2,
    border: 0,
    borderRadius: 2,
    boxShadow: `0 0 0 1px ${colors.gray6}`,
    color: colors.gray12,
    fontSize: 14,
    minHeight: 32,
    padding: "6px 8px",
    resize: "vertical",
  },
  focus: {
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
    outline: "none",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  segmented: { display: "flex", gap: 4 },
  segment: {
    backgroundColor: { default: colors.gray4, ":hover": colors.gray5 },
    border: 0,
    borderRadius: 4,
    color: colors.gray11,
    cursor: "pointer",
    fontSize: 12,
    padding: "4px 10px",
  },
  segmentActive: { backgroundColor: colors.gray7, color: colors.gray12 },
  badge: {
    backgroundColor: colors.gray5,
    borderRadius: 999,
    color: colors.gray11,
    fontSize: 11,
    padding: "1px 8px",
    textTransform: "uppercase",
  },
  hint: { color: colors.gray11, fontSize: 12, margin: 0 },
  ready: { color: colors.execution, fontSize: 12, margin: 0 },
  pending: { color: colors.focus, fontSize: 12, margin: 0 },
  row: { alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" },
  link: { color: colors.execution },
  error: { color: colors.red10, fontSize: 12, margin: 0 },
});

type Rpc = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ClientRpcs>, RpcClientError.RpcClientError>;

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: Rpc;
  readonly onChanged: () => Promise<void>;
}

const typeLabels: Record<ConnectionType, string> = {
  managed: "Managed",
  remote: "Remote",
  local: "Local",
};

const typeHints: Record<ConnectionType, string> = {
  managed: "MacroGraph provisions and hosts a dedicated OpenCode instance for this connection.",
  remote: "Connect to an OpenCode server you run elsewhere.",
  local: "Use the OpenCode service running on this MacroGraph host.",
};

const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    typeof error.reason === "string"
    ? error.reason
    : "OpenCode request failed";
};

const Settings: Component<SettingsProps> = (props) => {
  const [selectedId, setSelectedId] = createSignal<ConnectionId | "new">();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");

  const connections = () => props.state().connections;
  const selected = createMemo(() => {
    const id = selectedId();
    if (id === "new") return "new" as const;
    return connections().find((connection) => connection.id === id) ?? connections()[0];
  });
  createEffect(
    () => connections().length,
    (count) => {
      if (count === 0 && selectedId() !== "new") setSelectedId("new");
    },
  );

  const run = async <A,>(effect: Effect.Effect<A, unknown>) => {
    if (pending()) return undefined;
    setPending(true);
    setError("");
    try {
      const exit = await Effect.runPromiseExit(effect);
      if (Exit.isFailure(exit)) {
        setError(failureMessage(exit.cause));
        return undefined;
      }
      await props.onChanged();
      return { value: exit.value };
    } finally {
      setPending(false);
    }
  };

  return (
    <div sx={styles.stack}>
      <div sx={styles.toolbar}>
        <select
          sx={[styles.input, styles.focus, styles.picker]}
          aria-label="OpenCode connection"
          disabled={connections().length === 0}
          value={(() => {
            const current = selected();
            return current === undefined || current === "new" ? "" : current.id;
          })()}
          onChange={(event) => {
            setError("");
            setSelectedId(event.currentTarget.value as ConnectionId);
          }}
        >
          <Show when={connections().length === 0}>
            <option value="">No connections yet</option>
          </Show>
          <Show when={selected() === "new" && connections().length > 0}>
            <option value="">New connection…</option>
          </Show>
          <For each={connections()}>
            {(connection) => (
              <option value={connection.id}>
                {connection.name} ({typeLabels[connection.target.type]})
              </option>
            )}
          </For>
        </select>
        <Button
          disabled={pending() || props.state().connectionTypes.length === 0}
          onClick={() => {
            setError("");
            setSelectedId("new");
          }}
        >
          Add Connection
        </Button>
      </div>

      <Switch>
        <Match when={selected() === "new"}>
          <NewConnection
            types={props.state().connectionTypes}
            pending={pending()}
            onCancel={connections().length > 0 ? () => setSelectedId(undefined) : undefined}
            onCreate={async (name, target) => {
              const created = await run(props.rpc.OpenCodeCreateConnection({ name, target }));
              if (created !== undefined) setSelectedId(created.value);
            }}
          />
        </Match>
        <Match
          when={(() => {
            const current = selected();
            return current === "new" ? undefined : current;
          })()}
        >
          {(connection) => (
            <ConnectionDetails
              connection={connection()}
              rpc={props.rpc}
              pending={pending()}
              run={run}
              onRemoved={() => setSelectedId(undefined)}
            />
          )}
        </Match>
      </Switch>

      <Show when={error()}>
        <p sx={styles.error} role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
};

const NewConnection: Component<{
  readonly types: ReadonlyArray<ConnectionType>;
  readonly pending: boolean;
  readonly onCancel: (() => void) | undefined;
  readonly onCreate: (
    name: string,
    target:
      | { readonly type: "managed"; readonly config: string }
      | { readonly type: "remote"; readonly url: string; readonly password: string }
      | { readonly type: "local" },
  ) => Promise<void>;
}> = (props) => {
  const [type, setType] = createSignal<ConnectionType>();
  const [name, setName] = createSignal("");
  const [config, setConfig] = createSignal("{}");
  const [url, setUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const currentType = () => type() ?? props.types[0];
  const isSelected = (option: ConnectionType) => currentType() === option;

  return (
    <form
      sx={styles.section}
      aria-label="New OpenCode connection"
      onSubmit={(event) => {
        event.preventDefault();
        const selected = currentType();
        if (selected === undefined) return;
        void props.onCreate(
          name(),
          selected === "managed"
            ? { type: "managed", config: config() }
            : selected === "remote"
              ? { type: "remote", url: url().trim(), password: password() }
              : { type: "local" },
        );
      }}
    >
      <p sx={styles.title}>New connection</p>
      <div sx={styles.segmented} role="radiogroup" aria-label="Connection type">
        <For each={props.types}>
          {(option) => (
            <button
              type="button"
              role="radio"
              aria-checked={currentType() === option ? "true" : "false"}
              sx={[styles.segment, isSelected(option) && styles.segmentActive]}
              onClick={() => setType(option)}
            >
              {typeLabels[option]}
            </button>
          )}
        </For>
      </div>
      <Show when={currentType()}>
        {(selected) => <p sx={styles.hint}>{typeHints[selected()]}</p>}
      </Show>
      <label sx={styles.label}>
        Name
        <input
          sx={[styles.input, styles.focus]}
          value={name()}
          placeholder="e.g. Production writer"
          required
          disabled={props.pending}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <Show when={currentType() === "managed"}>
        <label sx={styles.label}>
          OpenCode config JSON
          <textarea
            sx={[styles.input, styles.focus]}
            rows={4}
            value={config()}
            required
            disabled={props.pending}
            onInput={(event) => setConfig(event.currentTarget.value)}
          />
        </label>
      </Show>
      <Show when={currentType() === "remote"}>
        <RemoteFields
          url={url()}
          password={password()}
          disabled={props.pending}
          onUrl={setUrl}
          onPassword={setPassword}
        />
      </Show>
      <div sx={styles.actions}>
        <Button
          type="submit"
          disabled={props.pending || !name().trim() || currentType() === undefined}
        >
          Create Connection
        </Button>
        <Show when={props.onCancel}>
          {(cancel) => (
            <Button type="button" disabled={props.pending} onClick={() => cancel()()}>
              Cancel
            </Button>
          )}
        </Show>
      </div>
    </form>
  );
};

const RemoteFields: Component<{
  readonly url: string;
  readonly password: string;
  readonly passwordPlaceholder?: string;
  readonly disabled: boolean;
  readonly onUrl: (value: string) => void;
  readonly onPassword: (value: string) => void;
}> = (props) => (
  <>
    <label sx={styles.label}>
      Server URL
      <input
        sx={[styles.input, styles.focus]}
        type="url"
        value={props.url}
        placeholder="https://opencode.example.com"
        required
        disabled={props.disabled}
        onInput={(event) => props.onUrl(event.currentTarget.value)}
      />
    </label>
    <label sx={styles.label}>
      Server password
      <input
        sx={[styles.input, styles.focus]}
        type="password"
        autocomplete="new-password"
        value={props.password}
        placeholder={props.passwordPlaceholder}
        disabled={props.disabled}
        onInput={(event) => props.onPassword(event.currentTarget.value)}
      />
    </label>
  </>
);

const ConnectionDetails: Component<{
  readonly connection: ConnectionState;
  readonly rpc: Rpc;
  readonly pending: boolean;
  readonly run: <A>(
    effect: Effect.Effect<A, unknown>,
  ) => Promise<{ readonly value: A } | undefined>;
  readonly onRemoved: () => void;
}> = (props) => {
  const connectionId = () => props.connection.id;
  const [name, setName] = createSignal("");
  const [config, setConfig] = createSignal("{}");
  const [url, setUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [integrationID, setIntegrationID] = createSignal("anthropic");
  const [key, setKey] = createSignal("");
  const [attempt, setAttempt] = createSignal<typeof OAuthAttempt.Type>();
  const [code, setCode] = createSignal("");

  createEffect(
    () => props.connection.id,
    () => {
      setName(props.connection.name);
      setConfig(props.connection.target.type === "managed" ? props.connection.target.config : "{}");
      setUrl(props.connection.target.type === "remote" ? props.connection.target.url : "");
      setPassword("");
      setAttempt(undefined);
    },
  );

  const save = () => {
    const target = props.connection.target;
    void props
      .run(
        props.rpc.OpenCodeUpdateConnection({
          connectionId: connectionId(),
          name: name(),
          target:
            target.type === "managed"
              ? { type: "managed", config: config() }
              : target.type === "remote"
                ? {
                    type: "remote",
                    url: url().trim(),
                    ...(password() === "" ? {} : { password: password() }),
                  }
                : { type: "local" },
        }),
      )
      .then((saved) => saved && setPassword(""));
  };

  return (
    <div sx={styles.stack}>
      <section sx={styles.section} aria-label="Connection settings">
        <div sx={styles.heading}>
          <p sx={styles.title}>{props.connection.name}</p>
          <span sx={styles.badge}>{typeLabels[props.connection.target.type]}</span>
        </div>
        <Switch>
          <Match when={props.connection.status.state === "error" && props.connection.status}>
            {(status) => (
              <p sx={styles.error} role="status">
                Unavailable: {"message" in status() ? status().message : ""}
              </p>
            )}
          </Match>
          <Match
            when={
              props.connection.status.state === "ready" &&
              "appliedConfig" in props.connection.status &&
              props.connection.status.appliedConfig !== undefined
            }
          >
            <p sx={styles.pending} role="status">
              Connected. Config changes are queued and apply to the production instance on the next
              deploy.
            </p>
          </Match>
          <Match when={props.connection.status.state === "ready"}>
            <p sx={styles.ready} role="status">
              Connected
            </p>
          </Match>
        </Switch>
        <form
          sx={styles.stack}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label sx={styles.label}>
            Name
            <input
              sx={[styles.input, styles.focus]}
              value={name()}
              required
              disabled={props.pending}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <Show when={props.connection.target.type === "managed"}>
            <label sx={styles.label}>
              OpenCode config JSON
              <textarea
                sx={[styles.input, styles.focus]}
                rows={4}
                value={config()}
                required
                disabled={props.pending}
                onInput={(event) => setConfig(event.currentTarget.value)}
              />
            </label>
          </Show>
          <Show when={props.connection.target.type === "remote"}>
            <RemoteFields
              url={url()}
              password={password()}
              passwordPlaceholder="Unchanged"
              disabled={props.pending}
              onUrl={setUrl}
              onPassword={setPassword}
            />
          </Show>
          <div sx={styles.actions}>
            <Button type="submit" disabled={props.pending || !name().trim()}>
              Save
            </Button>
            <Button
              type="button"
              disabled={props.pending}
              onClick={() =>
                void props
                  .run(props.rpc.OpenCodeRemoveConnection({ connectionId: connectionId() }))
                  .then((removed) => removed && props.onRemoved())
              }
            >
              Remove Connection
            </Button>
          </div>
        </form>
      </section>

      <Show when={props.connection.status.state === "ready"}>
        <section sx={styles.section} aria-label="Provider credentials">
          <p sx={styles.title}>Provider credentials</p>
          <Show
            when={props.connection.credentials.length > 0}
            fallback={<p sx={styles.hint}>No provider credentials on this instance yet.</p>}
          >
            <For each={props.connection.credentials}>
              {(credential) => (
                <div sx={styles.row}>
                  <span>
                    {credential.integrationID}: {credential.label}
                    {credential.active ? " (active)" : ""}
                  </span>
                  <Button
                    disabled={props.pending}
                    onClick={() =>
                      void props.run(
                        props.rpc.OpenCodeRemoveCredential({
                          connectionId: connectionId(),
                          credentialID: credential.id,
                        }),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              )}
            </For>
          </Show>
          <form
            sx={styles.stack}
            onSubmit={(event) => {
              event.preventDefault();
              void props
                .run(
                  props.rpc.OpenCodeConnectKey({
                    connectionId: connectionId(),
                    integrationID: integrationID().trim(),
                    key: key(),
                  }),
                )
                .then((saved) => saved && setKey(""));
            }}
          >
            <div sx={styles.toolbar}>
              <input
                sx={[styles.input, styles.focus]}
                aria-label="Provider ID"
                value={integrationID()}
                placeholder="anthropic, openai…"
                required
                disabled={props.pending}
                onInput={(event) => setIntegrationID(event.currentTarget.value)}
              />
              <input
                sx={[styles.input, styles.focus, styles.picker]}
                aria-label="API key"
                type="password"
                autocomplete="new-password"
                value={key()}
                placeholder="API key"
                required
                disabled={props.pending}
                onInput={(event) => setKey(event.currentTarget.value)}
              />
              <Button type="submit" disabled={props.pending || !integrationID().trim() || !key()}>
                Add Key
              </Button>
            </div>
          </form>
          <Show when={props.connection.oauthMethods.length > 0}>
            <p sx={styles.hint}>Or sign in with a provider:</p>
            <div sx={styles.actions}>
              <For each={props.connection.oauthMethods}>
                {(method) => (
                  <Button
                    disabled={props.pending}
                    onClick={() =>
                      void props
                        .run(
                          props.rpc.OpenCodeStartOAuth({
                            connectionId: connectionId(),
                            integrationID: method.integrationID,
                            methodID: method.methodID,
                          }),
                        )
                        .then((started) => {
                          if (started === undefined) return;
                          setCode("");
                          setAttempt(started.value);
                        })
                    }
                  >
                    {method.integrationName}: {method.label}
                  </Button>
                )}
              </For>
            </div>
          </Show>
          <Show when={attempt()}>
            {(current) => (
              <div sx={styles.stack}>
                <a sx={styles.link} href={current().url} target="_blank" rel="noreferrer">
                  Open provider authorization
                </a>
                <Show when={current().instructions}>
                  <p sx={styles.hint}>{current().instructions}</p>
                </Show>
                <Show when={current().mode === "code"}>
                  <input
                    sx={[styles.input, styles.focus]}
                    aria-label="Authorization code"
                    value={code()}
                    placeholder="Authorization code"
                    disabled={props.pending}
                    onInput={(event) => setCode(event.currentTarget.value)}
                  />
                </Show>
                <div sx={styles.actions}>
                  <Button
                    disabled={props.pending}
                    onClick={() => {
                      const value = current();
                      void (
                        value.mode === "code"
                          ? props.run(
                              props.rpc.OpenCodeCompleteOAuth({
                                connectionId: connectionId(),
                                integrationID: value.integrationID,
                                attemptID: value.attemptID,
                                code: code(),
                              }),
                            )
                          : props.run(
                              props.rpc
                                .OpenCodeOAuthStatus({
                                  connectionId: connectionId(),
                                  integrationID: value.integrationID,
                                  attemptID: value.attemptID,
                                })
                                .pipe(
                                  Effect.flatMap((status) =>
                                    status.status === "pending" || status.status === "complete"
                                      ? Effect.succeed(status.status)
                                      : Effect.fail({
                                          reason:
                                            status.status === "failed"
                                              ? status.message
                                              : "Authorization expired. Start again.",
                                        }),
                                  ),
                                ),
                            )
                      ).then((result) => {
                        if (result !== undefined && result.value !== "pending")
                          setAttempt(undefined);
                      });
                    }}
                  >
                    {current().mode === "code" ? "Submit Code" : "Check Authorization"}
                  </Button>
                  <Button
                    disabled={props.pending}
                    onClick={() =>
                      void props
                        .run(
                          props.rpc.OpenCodeCancelOAuth({
                            connectionId: connectionId(),
                            integrationID: current().integrationID,
                            attemptID: current().attemptID,
                          }),
                        )
                        .then((cancelled) => cancelled && setAttempt(undefined))
                    }
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Show>
        </section>
      </Show>
    </div>
  );
};

export default Settings;
export const settings = ClientSettings.make({
  module,
  state: ClientState,
  initial: initialClientState,
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.error}>Module settings state is unavailable.</p>,
});
