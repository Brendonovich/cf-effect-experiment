import type { ModuleAdminRpc } from "@macrograph/module";

import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createMemo, createSignal } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState.tsx";
import { describeError, queryKeys, run } from "./client.ts";
import { useModulesAdmin } from "./context.ts";
import { Badge, Notice, TextField } from "./primitives.tsx";

/** Add, remove and trust registries. */
export function RegistriesPanel() {
  const admin = useModulesAdmin();
  const queryClient = useQueryClient();
  const [url, setUrl] = createSignal("");

  const registries = useQuery(() => ({
    queryKey: queryKeys.registries,
    queryFn: () => run(admin.client().ListRegistries({})),
  }));
  const add = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: (value: string) => run(admin.client().AddRegistry({ url: value })),
    onSuccess: () => {
      setUrl("");
      return queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  }));

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const value = url().trim();
    if (value.length > 0 && !add.isPending) add.mutate(value);
  };

  return (
    <div sx={styles.root}>
      <p sx={styles.hint}>
        The server fetches modules from these registries. Releases from an untrusted registry always
        ask for confirmation before installing.
      </p>
      <form sx={styles.form} onSubmit={submit}>
        <TextField
          type="url"
          placeholder="https://registry.example.com"
          aria-label="Registry URL"
          value={url()}
          onInput={(event) => setUrl(event.currentTarget.value)}
        />
        <Button type="submit" size="sm" disabled={add.isPending || url().trim() === ""}>
          {add.isPending ? "Adding..." : "Add registry"}
        </Button>
      </form>
      <Show when={add.error}>
        {(error) => (
          <Notice tone="danger" role="alert">
            {describeError(error())}
          </Notice>
        )}
      </Show>

      <Show
        when={registries.data}
        fallback={
          <Show when={registries.isError} fallback={<LoadingState label="Loading registries..." />}>
            <Notice tone="danger" role="alert">
              {describeError(registries.error)}
            </Notice>
          </Show>
        }
      >
        {(list) => (
          <Show when={list().length > 0} fallback={<p sx={styles.hint}>No registries added.</p>}>
            <ul sx={styles.list} aria-label="Registries">
              <For each={list()} keyed={(registry) => registry.namespace}>
                {(registry) => <RegistryRow registry={registry()} />}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  );
}

function RegistryRow(props: { readonly registry: ModuleAdminRpc.Registry }) {
  const admin = useModulesAdmin();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.all });

  const setTrusted = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: (trusted: boolean) =>
      run(admin.client().SetRegistryTrusted({ namespace: props.registry.namespace, trusted })),
    onSuccess: invalidate,
  }));
  const remove = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: () => run(admin.client().RemoveRegistry({ namespace: props.registry.namespace })),
    onSuccess: invalidate,
  }));
  const error = createMemo(() => {
    const value = setTrusted.error ?? remove.error;
    return value === null ? null : describeError(value);
  });

  return (
    <li sx={styles.row} data-registry-row={props.registry.namespace}>
      <div sx={styles.rowMain}>
        <div sx={styles.identity}>
          <span sx={styles.titleLine}>
            <span sx={styles.name}>{props.registry.displayName}</span>
            <Show when={props.registry.official}>
              <Badge tone="info">Official</Badge>
            </Show>
            <Badge tone={props.registry.trusted ? "success" : "warning"}>
              {props.registry.trusted ? "Trusted" : "Untrusted"}
            </Badge>
          </span>
          <span sx={styles.mono}>{props.registry.namespace}</span>
          <span sx={styles.mono}>{props.registry.url}</span>
          <span sx={styles.muted}>
            {props.registry.keys.length} pinned signing{" "}
            {props.registry.keys.length === 1 ? "key" : "keys"}
          </span>
        </div>
        <div sx={styles.actions}>
          <label sx={styles.toggle}>
            <input
              type="checkbox"
              checked={props.registry.trusted}
              disabled={setTrusted.isPending}
              onChange={(event) => {
                const trusted = event.currentTarget.checked;
                // Keep showing the server's value until the change is saved.
                event.currentTarget.checked = props.registry.trusted;
                setTrusted.mutate(trusted);
              }}
              aria-label={`Trust ${props.registry.displayName}`}
            />
            <span>{setTrusted.isPending ? "Saving..." : "Trust releases"}</span>
          </label>
          <Show when={!props.registry.official}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              aria-label={`Remove ${props.registry.displayName}`}
            >
              {remove.isPending ? "Removing..." : "Remove"}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={error()}>
        {(message) => (
          <p sx={styles.error} role="alert">
            {message()}
          </p>
        )}
      </Show>
    </li>
  );
}

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: 12 },
  hint: { margin: 0, lineHeight: "18px", color: colors.gray11 },
  form: { display: "flex", alignItems: "center", gap: 8 },
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingBlock: 10,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  rowMain: { display: "flex", alignItems: "flex-start", gap: 12 },
  identity: { display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 },
  titleLine: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 },
  name: { fontSize: 13, fontWeight: 500, color: colors.gray12 },
  mono: { fontFamily: "monospace", fontSize: 11, color: colors.gray10, overflowWrap: "anywhere" },
  muted: { fontSize: 11, color: colors.gray10 },
  actions: { display: "flex", alignItems: "center", gap: 8 },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    color: colors.gray12,
  },
  error: { margin: 0, color: colors.red10 },
});
