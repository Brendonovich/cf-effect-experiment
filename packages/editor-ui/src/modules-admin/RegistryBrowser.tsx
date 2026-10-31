import { type ModuleAdminRpc, ModuleId } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { skipToken, useQuery } from "@tanstack/solid-query";
import { For, Show, createMemo, createSignal, untrack } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState.tsx";
import { describeError, queryKeys, run } from "./client.ts";
import { useModulesAdmin } from "./context.ts";
import { Badge, Notice, TextField } from "./primitives.tsx";

interface Search {
  readonly namespace: string | undefined;
  readonly query: string;
}

/** Search registries and install or update releases. */
export function RegistryBrowser(props: { readonly initialSearch?: string | undefined }) {
  const admin = useModulesAdmin();
  const [namespace, setNamespace] = createSignal("");
  const [query, setQuery] = createSignal(untrack(() => props.initialSearch) ?? "");
  const [search, setSearch] = createSignal<Search | null>(
    untrack(() =>
      props.initialSearch === undefined
        ? null
        : { namespace: undefined, query: props.initialSearch.trim() },
    ),
  );
  const [selected, setSelected] = createSignal<ModuleId.Id | null>(null);

  const registries = useQuery(() => ({
    queryKey: queryKeys.registries,
    queryFn: () => run(admin.client().ListRegistries({})),
  }));
  const results = useQuery(() => {
    const current = search();
    return {
      queryKey: queryKeys.search(current?.namespace, current?.query ?? ""),
      queryFn:
        current === null
          ? skipToken
          : () =>
              run(
                admin.client().SearchRegistry({
                  query: current.query,
                  ...(current.namespace === undefined ? {} : { namespace: current.namespace }),
                }),
              ),
    };
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setSelected(null);
    setSearch({ namespace: namespace() === "" ? undefined : namespace(), query: query().trim() });
  };

  return (
    <div sx={styles.root}>
      <form sx={styles.form} onSubmit={submit} role="search">
        <select
          sx={styles.select}
          aria-label="Registry"
          value={namespace()}
          onChange={(event) => setNamespace(event.currentTarget.value)}
        >
          <option value="">All registries</option>
          <For each={registries.data ?? []}>
            {(registry) => <option value={registry.namespace}>{registry.displayName}</option>}
          </For>
        </select>
        <TextField
          type="search"
          placeholder="Search modules"
          aria-label="Search modules"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <Button type="submit" size="sm" disabled={results.isFetching}>
          {results.isFetching ? "Searching..." : "Search"}
        </Button>
      </form>

      <Show when={selected()}>
        {(id) => <PackageDetail id={id()} onBack={() => setSelected(null)} />}
      </Show>

      <Show when={selected() === null}>
        <Show
          when={search() !== null}
          fallback={<p sx={styles.hint}>Search a registry to find modules to install.</p>}
        >
          <Show
            when={results.data}
            fallback={
              <Show when={results.isError} fallback={<LoadingState label="Searching..." compact />}>
                <Notice tone="danger" role="alert">
                  {describeError(results.error)}
                </Notice>
              </Show>
            }
          >
            {(list) => (
              <Show
                when={list().length > 0}
                fallback={<p sx={styles.hint}>No modules match your search.</p>}
              >
                <ul sx={styles.list} aria-label="Search results">
                  <For each={list()} keyed={(result) => result.id}>
                    {(result) => (
                      <SearchResult result={result()} onSelect={() => setSelected(result().id)} />
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function SearchResult(props: {
  readonly result: ModuleAdminRpc.RegistrySearchResult;
  readonly onSelect: () => void;
}) {
  return (
    <li sx={styles.result} data-search-result={props.result.id}>
      <button type="button" sx={styles.resultButton} onClick={() => props.onSelect()}>
        <span sx={styles.titleLine}>
          <span sx={styles.name}>{props.result.displayName}</span>
          <span sx={styles.mono}>{props.result.latestVersion}</span>
          <Show when={props.result.installedVersion}>
            {(version) => <Badge tone="info">Installed {version()}</Badge>}
          </Show>
        </span>
        <span sx={styles.id}>{ModuleId.toDisplay(props.result.id)}</span>
        <Show when={props.result.description}>
          {(description) => <span sx={styles.muted}>{description()}</span>}
        </Show>
      </button>
    </li>
  );
}

function PackageDetail(props: { readonly id: ModuleId.Id; readonly onBack: () => void }) {
  const admin = useModulesAdmin();
  const pkg = useQuery(() => ({
    queryKey: queryKeys.registryPackage(props.id),
    queryFn: () => run(admin.client().GetRegistryPackage({ id: props.id })),
  }));

  return (
    <div sx={styles.detail} data-registry-package={props.id}>
      <div>
        <Button type="button" size="sm" variant="text" onClick={() => props.onBack()}>
          ← Back to results
        </Button>
      </div>
      <Show
        when={pkg.data}
        fallback={
          <Show when={pkg.isError} fallback={<LoadingState label="Loading package..." compact />}>
            <Notice tone="danger" role="alert">
              {describeError(pkg.error)}
            </Notice>
          </Show>
        }
      >
        {(data) => (
          <>
            <div sx={styles.detailHeader}>
              <span sx={styles.titleLine}>
                <h4 sx={styles.detailTitle}>{data().displayName}</h4>
                <Show when={data().installedVersion}>
                  {(version) => <Badge tone="info">Installed {version()}</Badge>}
                </Show>
              </span>
              <span sx={styles.id}>
                {ModuleId.toDisplay(data().id)} · published by {ModuleId.publisher(data().id)} on{" "}
                {ModuleId.namespace(data().id)}
              </span>
              <Show when={data().description}>
                {(description) => <p sx={styles.muted}>{description()}</p>}
              </Show>
            </div>
            <table sx={styles.table} aria-label="Releases">
              <thead>
                <tr>
                  <th sx={styles.th}>Version</th>
                  <th sx={styles.th}>Published</th>
                  <th sx={styles.th}>Trust</th>
                  <th sx={styles.th}>Status</th>
                  <th sx={styles.th}>Declares</th>
                  <th sx={styles.th}>
                    <span sx={styles.visuallyHidden}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={data().releases} keyed={(release) => release.version}>
                  {(release) => (
                    <ReleaseRow
                      pkg={data()}
                      release={release()}
                      installing={admin.installing(data().id) !== null}
                    />
                  )}
                </For>
              </tbody>
            </table>
          </>
        )}
      </Show>
    </div>
  );
}

function ReleaseRow(props: {
  readonly pkg: ModuleAdminRpc.RegistryPackage;
  readonly release: ModuleAdminRpc.RegistryRelease;
  readonly installing: boolean;
}) {
  const admin = useModulesAdmin();
  const installed = createMemo(() => props.pkg.installedVersion === props.release.version);
  const kind = createMemo(() =>
    props.pkg.installedVersion === undefined ? ("install" as const) : ("update" as const),
  );
  const unavailable = createMemo(() => {
    if (props.release.status !== "active") return `This release was ${props.release.status}`;
    if (!props.release.compatible)
      return `Needs module API ${props.release.api}, which this server doesn't support`;
    return null;
  });
  const declarations = createMemo(() =>
    [
      ...props.release.requires,
      ...props.release.node.map((name) => `node:${name}`),
      ...props.release.native.map((name) => `native:${name}`),
    ].join(", "),
  );
  const install = () =>
    admin.requestInstall({
      kind: kind(),
      id: props.pkg.id,
      version: props.release.version,
      ...(props.release.trust === "untrusted"
        ? {
            untrusted: {
              version: props.release.version,
              requires: props.release.requires,
              node: props.release.node,
              native: props.release.native,
            },
          }
        : {}),
    });

  return (
    <tr data-release={props.release.version}>
      <td sx={[styles.td, styles.mono]}>{props.release.version}</td>
      <td sx={styles.td}>{new Date(props.release.publishedAt).toLocaleDateString()}</td>
      <td sx={styles.td}>
        <Badge tone={props.release.trust === "trusted" ? "success" : "warning"}>
          {props.release.trust === "trusted" ? "Trusted" : "Untrusted"}
        </Badge>
      </td>
      <td sx={styles.td}>
        <Show
          when={props.release.status !== "active"}
          fallback={
            <Show when={!props.release.compatible} fallback={<Badge tone="success">Active</Badge>}>
              <Badge tone="neutral">Incompatible</Badge>
            </Show>
          }
        >
          <Badge tone="danger" title={props.release.reason}>
            {props.release.status === "revoked" ? "Revoked" : "Yanked"}
          </Badge>
          <Show when={props.release.reason}>
            {(reason) => <span sx={styles.reason}>{reason()}</span>}
          </Show>
        </Show>
      </td>
      <td sx={[styles.td, styles.mono]}>{declarations() || "—"}</td>
      <td sx={[styles.td, styles.actionCell]}>
        <Show when={!installed()} fallback={<span sx={styles.muted}>Installed</span>}>
          <Button
            type="button"
            size="sm"
            variant={kind() === "install" ? "primary" : "secondary"}
            disabled={unavailable() !== null || props.installing}
            title={unavailable() ?? undefined}
            onClick={install}
            aria-label={`${kind() === "install" ? "Install" : "Update to"} ${props.release.version}`}
          >
            {kind() === "install" ? "Install" : "Update to"}
          </Button>
        </Show>
      </td>
    </tr>
  );
}

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: 12 },
  form: { display: "flex", alignItems: "center", gap: 8 },
  select: {
    height: 24,
    borderColor: colors.gray6,
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray1,
    color: colors.gray12,
    fontSize: 12,
    paddingInline: 4,
  },
  hint: { margin: 0, color: colors.gray11 },
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  result: { borderBottomColor: colors.gray4, borderBottomStyle: "solid", borderBottomWidth: 1 },
  resultButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    color: colors.gray12,
    cursor: "pointer",
    paddingBlock: 8,
    paddingInline: 6,
    textAlign: "left",
    fontSize: 12,
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  titleLine: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 },
  name: { fontSize: 13, fontWeight: 500 },
  mono: { fontFamily: "monospace" },
  id: { fontFamily: "monospace", fontSize: 11, color: colors.gray10 },
  muted: { margin: 0, color: colors.gray11 },
  detail: { display: "flex", flexDirection: "column", gap: 12 },
  detailHeader: { display: "flex", flexDirection: "column", gap: 4 },
  detailTitle: { margin: 0, fontSize: 14, fontWeight: 500 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
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
    verticalAlign: "top",
    color: colors.gray12,
    paddingBlock: 6,
    paddingInline: 6,
    borderBottomColor: colors.gray3,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    overflowWrap: "anywhere",
  },
  reason: { display: "block", marginTop: 2, fontSize: 11, color: colors.gray11 },
  actionCell: { textAlign: "right" },
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
