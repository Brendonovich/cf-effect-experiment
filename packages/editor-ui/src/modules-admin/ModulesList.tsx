import { type ModuleAdminRpc, type ModuleCatalog, ModuleId } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createMemo } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState.tsx";
import { describeError, queryKeys, run, sourceLabels, statusLabels } from "./client.ts";
import { useModulesAdmin } from "./context.ts";
import { Badge, Notice, type Tone } from "./primitives.tsx";

const sourceTones: Record<ModuleCatalog.SourceKind, Tone> = {
  shipped: "neutral",
  installed: "info",
  local: "warning",
  linked: "warning",
};

const statusTones: Record<ModuleCatalog.Status, Tone> = {
  discovered: "neutral",
  loading: "info",
  loaded: "success",
  failed: "danger",
  disabled: "neutral",
};

export function TrustBadge(props: { readonly trust: ModuleCatalog.Trust | undefined }) {
  const level = createMemo(() => props.trust?.current ?? props.trust?.installed);
  const changed = createMemo(
    () => props.trust?.current !== undefined && props.trust.current !== props.trust.installed,
  );
  return (
    <Show when={props.trust}>
      {(trust) => (
        <Badge
          tone={level() === "trusted" ? "success" : "warning"}
          title={`${level() === "trusted" ? "Trusted" : "Untrusted"} release from ${trust().registry}${changed() ? `; it was ${trust().installed} when installed` : ""}`}
        >
          {level() === "trusted" ? "Trusted" : "Untrusted"}
          {changed() ? " (changed)" : ""}
        </Badge>
      )}
    </Show>
  );
}

/** Lists every module with its status, flags and lifecycle actions. */
export function ModulesList() {
  const admin = useModulesAdmin();
  const queryClient = useQueryClient();
  const modules = useQuery(() => ({
    queryKey: queryKeys.modules,
    queryFn: () => run(admin.client().ListModules({})),
  }));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.all });

  const rescan = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: () => run(admin.client().RescanModules({})),
    onSuccess: invalidate,
  }));
  const checkForUpdates = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: () => run(admin.client().CheckForUpdates({})),
    onSuccess: invalidate,
  }));
  const toolbarError = createMemo(() => {
    const error = rescan.error ?? checkForUpdates.error;
    return error === null ? null : describeError(error);
  });

  return (
    <div sx={styles.root}>
      <div sx={styles.toolbar}>
        <span sx={styles.count}>
          <Show when={modules.data}>{(list) => `${list().length} modules`}</Show>
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={checkForUpdates.isPending}
          onClick={() => checkForUpdates.mutate()}
        >
          {checkForUpdates.isPending ? "Checking..." : "Check for updates"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={rescan.isPending}
          onClick={() => rescan.mutate()}
        >
          {rescan.isPending ? "Rescanning..." : "Rescan"}
        </Button>
      </div>

      <Show when={toolbarError()}>
        {(error) => (
          <Notice tone="danger" role="alert">
            {error()}
          </Notice>
        )}
      </Show>

      <Show
        when={modules.data}
        fallback={
          <Show when={modules.isError} fallback={<LoadingState label="Loading modules..." />}>
            <Notice
              tone="danger"
              role="alert"
              action={
                <Button type="button" size="sm" variant="text" onClick={() => modules.refetch()}>
                  Retry
                </Button>
              }
            >
              {describeError(modules.error)}
            </Notice>
          </Show>
        }
      >
        {(list) => (
          <Show when={list().length > 0} fallback={<p sx={styles.empty}>No modules found.</p>}>
            <ul sx={styles.list} aria-label="Modules">
              <For each={list()} keyed={(module) => module.entry.id}>
                {(module) => <ModuleRow module={module()} />}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  );
}

function ModuleRow(props: { readonly module: ModuleAdminRpc.ModuleDetails }) {
  const admin = useModulesAdmin();
  const queryClient = useQueryClient();
  const entry = () => props.module.entry;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.all });

  const reload = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: () => run(admin.client().ReloadModule({ id: entry().id })),
    onSuccess: invalidate,
  }));
  const setEnabled = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: (enabled: boolean) =>
      run(admin.client().SetModuleEnabled({ id: entry().id, enabled })),
    onSuccess: invalidate,
  }));
  const uninstall = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: () => run(admin.client().UninstallModule({ id: entry().id })),
    onSuccess: invalidate,
  }));
  const unlink = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: () => run(admin.client().UnlinkModule({ id: entry().id })),
    onSuccess: invalidate,
  }));

  const busy = createMemo(
    () =>
      reload.isPending ||
      setEnabled.isPending ||
      uninstall.isPending ||
      unlink.isPending ||
      admin.installing(entry().id) !== null,
  );
  const actionError = createMemo(() => {
    const error = reload.error ?? setEnabled.error ?? uninstall.error ?? unlink.error;
    return error === null ? null : describeError(error);
  });
  const incompatibleMessage = createMemo(() => {
    const copy = props.module.copies.find(
      (candidate) => candidate.source === "installed" && !candidate.compatible,
    );
    return `The installed version${copy ? ` ${copy.version} (module API ${copy.api})` : ""} isn't compatible with this server, so the built-in copy is used instead.`;
  });
  const shortId = createMemo(() => ModuleId.toDisplay(entry().id));

  return (
    <li sx={styles.row} data-module-row={entry().id}>
      <div sx={styles.rowMain}>
        <div sx={styles.identity}>
          <div sx={styles.titleLine}>
            <span sx={styles.name}>{entry().displayName}</span>
            <span sx={styles.version}>{entry().version}</span>
            <Badge tone={sourceTones[entry().source]}>{sourceLabels[entry().source]}</Badge>
            <Badge tone={statusTones[entry().status]}>{statusLabels[entry().status]}</Badge>
            <TrustBadge trust={entry().trust} />
            <Show when={entry().flags.updateAvailable}>
              <Badge tone="info">Update available</Badge>
            </Show>
          </div>
          <span sx={styles.id} title={entry().id}>
            {shortId()}
          </span>
          <Show when={entry().description}>
            {(description) => <p sx={styles.descriptionText}>{description()}</p>}
          </Show>
          <Show when={props.module.path}>{(path) => <span sx={styles.path}>{path()}</span>}</Show>
        </div>

        <div sx={styles.actions}>
          <Show when={entry().flags.updateAvailable}>
            <Button
              type="button"
              size="sm"
              disabled={busy()}
              onClick={() => admin.requestInstall({ kind: "update", id: entry().id })}
            >
              {admin.installing(entry().id) === "update" ? "Updating..." : "Update"}
            </Button>
          </Show>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy() || !props.module.enabled}
            onClick={() => reload.mutate()}
            aria-label={`Reload ${entry().displayName}`}
          >
            {reload.isPending ? "Reloading..." : "Reload"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy()}
            onClick={() => setEnabled.mutate(!props.module.enabled)}
          >
            {setEnabled.isPending
              ? props.module.enabled
                ? "Disabling..."
                : "Enabling..."
              : props.module.enabled
                ? "Disable"
                : "Enable"}
          </Button>
          <Show when={entry().source === "installed"}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy()}
              onClick={() => uninstall.mutate()}
              aria-label={`Uninstall ${entry().displayName}`}
            >
              {uninstall.isPending ? "Uninstalling..." : "Uninstall"}
            </Button>
          </Show>
          <Show when={entry().source === "linked"}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy()}
              onClick={() => unlink.mutate()}
            >
              {unlink.isPending ? "Unlinking..." : "Unlink"}
            </Button>
          </Show>
        </div>
      </div>

      <Show when={entry().flags.revoked}>
        <Notice tone="danger" role="alert">
          <strong>This release was revoked by {entry().trust?.registry ?? "its registry"}.</strong>{" "}
          {entry().trust?.reason ?? "No reason was given."} It keeps running until you update or
          uninstall it.
        </Notice>
      </Show>
      <Show when={entry().flags.stale}>
        <Notice
          tone="warning"
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy()}
              onClick={() => reload.mutate()}
            >
              Reload now
            </Button>
          }
        >
          Changed on disk — reload to apply the changes.
        </Notice>
      </Show>
      <Show when={entry().flags.incompatibleInstalled}>
        <Notice tone="warning">{incompatibleMessage()}</Notice>
      </Show>
      <Show when={entry().error}>
        {(error) => (
          <Notice tone="danger">
            <pre sx={styles.errorText}>{error()}</pre>
          </Notice>
        )}
      </Show>
      <Show when={actionError()}>
        {(error) => (
          <p sx={styles.actionError} role="alert">
            {error()}
          </p>
        )}
      </Show>
    </li>
  );
}

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: 8 },
  toolbar: { display: "flex", alignItems: "center", gap: 8 },
  count: { flex: 1, color: colors.gray10 },
  empty: { margin: 0, color: colors.gray11 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
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
  version: { fontFamily: "monospace", color: colors.gray11 },
  id: { fontFamily: "monospace", fontSize: 11, color: colors.gray10 },
  descriptionText: { margin: 0, color: colors.gray11 },
  path: { fontFamily: "monospace", fontSize: 11, color: colors.gray10, overflowWrap: "anywhere" },
  actions: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 },
  errorText: {
    margin: 0,
    fontFamily: "monospace",
    fontSize: 11,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  actionError: { margin: 0, color: colors.red10 },
});
