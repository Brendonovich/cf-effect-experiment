import { type ModuleAdminRpc, ModuleId } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createMemo, createSignal } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState.tsx";
import { describeError, queryKeys, run } from "./client.ts";
import { useModulesAdmin } from "./context.ts";
import { Notice, TextField } from "./primitives.tsx";

/** Link a module id to a folder on the server, overriding every other copy. */
export function DevLinksPanel() {
  const admin = useModulesAdmin();
  const queryClient = useQueryClient();
  const [id, setId] = createSignal("");
  const [path, setPath] = createSignal("");

  const modules = useQuery(() => ({
    queryKey: queryKeys.modules,
    queryFn: () => run(admin.client().ListModules({})),
  }));
  const links = createMemo(() =>
    (modules.data ?? []).filter((module) => module.entry.source === "linked"),
  );
  const parsedId = createMemo(() => ModuleId.parseDisplay(id().trim()));
  const idInvalid = createMemo(() => id().trim() !== "" && parsedId()._tag === "None");

  const link = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: (variables: { readonly id: ModuleId.Id; readonly path: string }) =>
      run(admin.client().LinkModule(variables)),
    onSuccess: () => {
      setId("");
      setPath("");
      return queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  }));

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parsedId();
    const folder = path().trim();
    if (parsed._tag === "None" || folder === "" || link.isPending) return;
    link.mutate({ id: parsed.value, path: folder });
  };

  return (
    <div sx={styles.root}>
      <p sx={styles.hint}>
        A dev link loads a module id from a folder on the server, such as your build output. It wins
        over shipped and installed copies until you unlink it.
      </p>
      <form sx={styles.form} onSubmit={submit}>
        <TextField
          placeholder="publisher/name or namespace/publisher/name"
          aria-label="Module id"
          aria-invalid={idInvalid() ? "true" : "false"}
          value={id()}
          onInput={(event) => setId(event.currentTarget.value)}
        />
        <TextField
          placeholder="/path/to/module/dist"
          aria-label="Folder path"
          value={path()}
          onInput={(event) => setPath(event.currentTarget.value)}
        />
        <Button
          type="submit"
          size="sm"
          disabled={link.isPending || parsedId()._tag === "None" || path().trim() === ""}
        >
          {link.isPending ? "Linking..." : "Link"}
        </Button>
      </form>
      <Show when={idInvalid()}>
        <p sx={styles.error}>Enter a module id such as macrograph/twitch or local/me/overlay.</p>
      </Show>
      <Show when={link.error}>
        {(error) => (
          <Notice tone="danger" role="alert">
            {describeError(error())}
          </Notice>
        )}
      </Show>

      <Show
        when={modules.data}
        fallback={
          <Show when={modules.isError} fallback={<LoadingState label="Loading links..." />}>
            <Notice tone="danger" role="alert">
              {describeError(modules.error)}
            </Notice>
          </Show>
        }
      >
        <Show when={links().length > 0} fallback={<p sx={styles.hint}>No dev links.</p>}>
          <ul sx={styles.list} aria-label="Dev links">
            <For each={links()} keyed={(module) => module.entry.id}>
              {(module) => <LinkRow module={module()} />}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}

function LinkRow(props: { readonly module: ModuleAdminRpc.ModuleDetails }) {
  const admin = useModulesAdmin();
  const queryClient = useQueryClient();
  const unlink = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: () => run(admin.client().UnlinkModule({ id: props.module.entry.id })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all }),
  }));

  return (
    <li sx={styles.row} data-link-row={props.module.entry.id}>
      <div sx={styles.identity}>
        <span sx={styles.name}>{ModuleId.toDisplay(props.module.entry.id)}</span>
        <span sx={styles.mono}>{props.module.path ?? "Unknown folder"}</span>
        <Show when={unlink.error}>
          {(error) => (
            <span sx={styles.error} role="alert">
              {describeError(error())}
            </span>
          )}
        </Show>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={unlink.isPending}
        onClick={() => unlink.mutate()}
        aria-label={`Unlink ${ModuleId.toDisplay(props.module.entry.id)}`}
      >
        {unlink.isPending ? "Unlinking..." : "Unlink"}
      </Button>
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
    alignItems: "center",
    gap: 12,
    paddingBlock: 8,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  identity: { display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 },
  name: { fontFamily: "monospace", fontSize: 12, color: colors.gray12 },
  mono: { fontFamily: "monospace", fontSize: 11, color: colors.gray10, overflowWrap: "anywhere" },
  error: { margin: 0, fontSize: 12, color: colors.red10 },
});
