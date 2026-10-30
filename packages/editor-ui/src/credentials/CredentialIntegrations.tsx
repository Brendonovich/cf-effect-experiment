import type { Credential } from "@macrograph/module";
import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";

import { credentialRowMarker, searchMarker } from "../editor/markers.stylex.ts";
import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import { ProviderIcon, providerDescription } from "./ProviderIcon";

export interface CredentialProvider {
  readonly id: string;
  readonly displayName: string;
}

export interface CredentialIntegrationsProps {
  readonly title?: string;
  readonly description?: JSX.Element;
  readonly providers: ReadonlyArray<CredentialProvider>;
  readonly credentials: ReadonlyArray<Credential.Summary>;
  readonly onConnect?: (provider: string) => void;
  readonly connecting?: (provider: string) => boolean;
  readonly onRemove?: (credential: Credential.Summary) => void;
  readonly removing?: (credential: Credential.Summary) => boolean;
  readonly notice?: JSX.Element;
  /** Providers expanded on first render. */
  readonly defaultExpanded?: ReadonlyArray<string>;
  /** Show the status column. Hide it when the source does not report credential status. */
  readonly showStatus?: boolean;
  /**
   * On narrow viewports, run lists to the container's edges and give the text its own gutter.
   * Use when the container has no side padding on mobile.
   */
  readonly edgeToEdge?: boolean;
}

const amber = "#ffc53d";
const green = "#3dd68c";

const narrow = "@media (max-width: 639px)";

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: 32, color: colors.gray12 },
  rootEdgeToEdge: { gap: { default: 32, [narrow]: 24 } },
  gutter: { paddingInline: { default: 0, [narrow]: 16 } },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  heading: { flex: "1 1 280px", minWidth: 0 },
  title: { margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 500 },
  subtitle: { margin: 0, marginTop: 4, fontSize: 14, lineHeight: "20px", color: colors.gray11 },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    width: { default: 240, [narrow]: "100%" },
    height: 36,
    boxSizing: "border-box",
    paddingInline: 12,
    borderColor: {
      default: colors.gray5,
      [stylex.when.ancestor(":focus-within", searchMarker)]: colors.gray8,
    },
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray3,
  },
  searchIcon: { flexShrink: 0, width: 16, height: 16, color: colors.gray10 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: 0,
    outline: "none",
    backgroundColor: "transparent",
    fontSize: 14,
    color: colors.gray12,
    "::placeholder": { color: colors.gray9 },
  },
  section: { display: "flex", flexDirection: "column", gap: 12 },
  sectionHeading: { margin: 0, fontSize: 15, lineHeight: "20px", fontWeight: 500 },
  list: {
    overflow: "hidden",
    borderColor: colors.gray5,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray2,
  },
  listEdgeToEdge: {
    borderInlineWidth: { default: 1, [narrow]: 0 },
    borderRadius: { default: 8, [narrow]: 0 },
  },
  group: {
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    width: "100%",
    minHeight: 72,
    boxSizing: "border-box",
    paddingBlock: 14,
    paddingInline: 16,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  toggle: {
    border: 0,
    borderRadius: 0,
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  body: { display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 },
  name: {
    overflow: "hidden",
    margin: 0,
    fontSize: 15,
    lineHeight: "20px",
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: {
    overflow: "hidden",
    margin: 0,
    fontSize: 13,
    lineHeight: "18px",
    color: colors.gray11,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  trailing: { display: "flex", flexShrink: 0, alignItems: "center", gap: 12 },
  facepile: { display: "flex", alignItems: "center" },
  face: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    marginLeft: { default: -6, ":first-child": 0 },
    borderColor: colors.gray2,
    borderStyle: "solid",
    borderWidth: 2,
    borderRadius: 9999,
    backgroundColor: colors.gray5,
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    color: colors.gray11,
  },
  faceWarn: { backgroundColor: "rgb(255 197 61 / 0.25)", color: amber },
  count: { minWidth: 12, fontSize: 13, color: colors.gray10, fontVariantNumeric: "tabular-nums" },
  chevron: { width: 16, height: 16, color: colors.gray9, transitionProperty: "transform" },
  chevronOpen: { transform: "rotate(180deg)" },
  panel: {
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    paddingBlock: 6,
    backgroundColor: colors.gray1,
  },
  panelRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 160px) 80px 28px",
    alignItems: "center",
    gap: 12,
    minHeight: 36,
    paddingLeft: 62,
    paddingRight: 16,
    fontSize: 13,
  },
  panelRowWithoutStatus: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 160px) 28px" },
  panelRowEdgeToEdge: { paddingLeft: { default: 62, [narrow]: 16 } },
  panelHead: {
    minHeight: 28,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: colors.gray9,
  },
  cell: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: colors.gray10 },
  status: { display: "inline-flex", alignItems: "center", gap: 6 },
  statusOn: { color: green },
  statusWarn: { color: amber },
  statusOff: { color: colors.gray10 },
  statusDot: { width: 6, height: 6, borderRadius: 9999, backgroundColor: "currentColor" },
  remove: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    border: 0,
    borderRadius: 6,
    backgroundColor: { default: "transparent", ":hover": colors.red3 },
    color: { default: colors.gray9, ":hover": colors.red10 },
    cursor: "pointer",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", credentialRowMarker)]: 1,
      ":focus-visible": 1,
      ":disabled": 0.5,
    },
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  removeIcon: { width: 15, height: 15 },
  add: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    paddingBlock: 8,
    paddingLeft: 62,
    paddingRight: 16,
    border: 0,
    backgroundColor: "transparent",
    fontSize: 13,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    cursor: { default: "pointer", ":disabled": "default" },
    outline: "none",
    textDecoration: { default: "none", ":focus-visible": "underline" },
  },
  addIcon: { width: 14, height: 14 },
  connect: { borderRadius: 6 },
  empty: { margin: 0, padding: 20, fontSize: 13, color: colors.gray10 },
});

const matches = (query: string, ...values: ReadonlyArray<string | null | undefined>) =>
  query === "" || values.some((value) => value?.toLowerCase().includes(query));

const statusLabel: Record<Credential.Summary["status"], string> = {
  available: "Active",
  expired: "Expired",
  unavailable: "Unavailable",
};
const statusStyle = {
  available: styles.statusOn,
  expired: styles.statusWarn,
  unavailable: styles.statusOff,
};

const accountName = (credential: Credential.Summary) => credential.displayName ?? credential.id;

export function CredentialIntegrations(props: CredentialIntegrationsProps) {
  const [search, setSearch] = createSignal("");
  const [expanded, setExpanded] = createSignal<ReadonlyArray<string>>(props.defaultExpanded ?? []);
  const query = () => search().trim().toLowerCase();
  const showStatus = () => props.showStatus ?? true;
  const gutter = () => (props.edgeToEdge ? styles.gutter : null);
  const list = () => (props.edgeToEdge ? styles.listEdgeToEdge : null);
  const panelRow = () => (props.edgeToEdge ? styles.panelRowEdgeToEdge : null);
  const isExpanded = (provider: string) => query() !== "" || expanded().includes(provider);
  const toggle = (provider: string) =>
    setExpanded((ids) =>
      ids.includes(provider) ? ids.filter((id) => id !== provider) : [...ids, provider],
    );

  const providerName = (id: string) =>
    props.providers.find((provider) => provider.id === id)?.displayName ??
    id.charAt(0).toUpperCase() + id.slice(1);
  const known = (id: string) => props.providers.some((provider) => provider.id === id);

  const providerIds = () => {
    const ids = props.providers.map((provider) => provider.id);
    for (const credential of props.credentials)
      if (!ids.includes(credential.provider)) ids.push(credential.provider);
    return ids;
  };

  const groups = () =>
    providerIds().flatMap((provider) => {
      const accounts = props.credentials.filter((credential) => credential.provider === provider);
      if (accounts.length === 0) return [];
      const visible = matches(query(), provider, providerName(provider))
        ? accounts
        : accounts.filter((credential) => matches(query(), credential.displayName, credential.id));
      return visible.length === 0 ? [] : [{ provider, total: accounts, accounts: visible }];
    });
  const available = () =>
    props.providers.filter(
      (provider) =>
        !props.credentials.some((credential) => credential.provider === provider.id) &&
        matches(
          query(),
          provider.id,
          provider.displayName,
          providerDescription(provider.id, provider.displayName),
        ),
    );

  return (
    <div sx={[styles.root, props.edgeToEdge ? styles.rootEdgeToEdge : null]}>
      <header sx={[styles.header, gutter()]}>
        <div sx={styles.heading}>
          <h1 sx={styles.title}>{props.title ?? "Credentials"}</h1>
          <p sx={styles.subtitle}>
            {props.description ?? "Connect external accounts to use them in your graphs."}
          </p>
        </div>
        <label sx={[searchMarker, styles.search]}>
          <IconTablerSearch aria-hidden="true" {...stylex.attrs(styles.searchIcon)} />
          <input
            type="search"
            sx={styles.searchInput}
            aria-label="Search credentials"
            placeholder="Search"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
      </header>

      {props.notice}

      <section sx={styles.section}>
        <h2 sx={[styles.sectionHeading, gutter()]}>Connected</h2>
        <div sx={[styles.list, list()]}>
          <For
            each={groups()}
            fallback={
              <p sx={styles.empty}>
                {query() === ""
                  ? "No accounts connected yet. Connect one below."
                  : "No connected accounts match your search."}
              </p>
            }
          >
            {(group) => {
              const panelId = `credential-accounts-${group.provider}`;
              return (
                <div sx={styles.group}>
                  <button
                    type="button"
                    sx={[styles.row, styles.toggle]}
                    aria-expanded={isExpanded(group.provider) ? "true" : "false"}
                    aria-controls={panelId}
                    onClick={() => toggle(group.provider)}
                  >
                    <ProviderIcon provider={group.provider} />
                    <span sx={styles.body}>
                      <span sx={styles.name}>{providerName(group.provider)}</span>
                      <span sx={styles.detail}>
                        {providerDescription(group.provider, providerName(group.provider))}
                      </span>
                    </span>
                    <span sx={styles.trailing}>
                      <span sx={styles.facepile} aria-hidden="true">
                        <For each={group.total.slice(0, 3)}>
                          {(credential) => (
                            <span
                              sx={[
                                styles.face,
                                credential.status !== "available" && styles.faceWarn,
                              ]}
                            >
                              {accountName(credential).slice(0, 1)}
                            </span>
                          )}
                        </For>
                      </span>
                      <span
                        sx={styles.count}
                        aria-label={`${group.total.length} ${group.total.length === 1 ? "account" : "accounts"}`}
                      >
                        {group.total.length}
                      </span>
                      <IconTablerChevronDown
                        aria-hidden="true"
                        {...stylex.attrs(
                          styles.chevron,
                          isExpanded(group.provider) && styles.chevronOpen,
                        )}
                      />
                    </span>
                  </button>
                  <Show when={isExpanded(group.provider)}>
                    <div id={panelId} sx={styles.panel}>
                      <div
                        sx={[
                          styles.panelRow,
                          showStatus() ? null : styles.panelRowWithoutStatus,
                          panelRow(),
                          styles.panelHead,
                        ]}
                        aria-hidden="true"
                      >
                        <span>Account</span>
                        <span>ID</span>
                        <Show when={showStatus()}>
                          <span>Status</span>
                        </Show>
                        <span />
                      </div>
                      <For each={group.accounts}>
                        {(credential) => (
                          <div
                            sx={[
                              credentialRowMarker,
                              styles.panelRow,
                              showStatus() ? null : styles.panelRowWithoutStatus,
                              panelRow(),
                            ]}
                          >
                            <span sx={styles.cell}>{accountName(credential)}</span>
                            <span sx={[styles.cell, styles.mono]}>{credential.id}</span>
                            <Show when={showStatus()}>
                              <span sx={[styles.status, statusStyle[credential.status]]}>
                                <span sx={styles.statusDot} />
                                {statusLabel[credential.status]}
                              </span>
                            </Show>
                            <Show when={props.onRemove}>
                              {(onRemove) => (
                                <button
                                  type="button"
                                  sx={styles.remove}
                                  aria-label={`Remove ${accountName(credential)}`}
                                  title="Remove"
                                  disabled={props.removing?.(credential) ?? false}
                                  onClick={() => onRemove()(credential)}
                                >
                                  <IconTablerTrash {...stylex.attrs(styles.removeIcon)} />
                                </button>
                              )}
                            </Show>
                          </div>
                        )}
                      </For>
                      <Show when={known(group.provider) ? props.onConnect : undefined}>
                        {(onConnect) => (
                          <button
                            type="button"
                            sx={[styles.add, panelRow()]}
                            disabled={props.connecting?.(group.provider) ?? false}
                            onClick={() => onConnect()(group.provider)}
                          >
                            <IconTablerPlus {...stylex.attrs(styles.addIcon)} />
                            {props.connecting?.(group.provider)
                              ? "Connecting..."
                              : `Add another ${providerName(group.provider)} account`}
                          </button>
                        )}
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </section>

      <section sx={styles.section}>
        <h2 sx={[styles.sectionHeading, gutter()]}>Available</h2>
        <div sx={[styles.list, list()]}>
          <For
            each={available()}
            fallback={
              <p sx={styles.empty}>
                {query() === ""
                  ? "Every provider is connected."
                  : "No providers match your search."}
              </p>
            }
          >
            {(provider) => (
              <div sx={styles.row}>
                <ProviderIcon provider={provider.id} />
                <div sx={styles.body}>
                  <p sx={styles.name}>{provider.displayName}</p>
                  <p sx={styles.detail}>{providerDescription(provider.id, provider.displayName)}</p>
                </div>
                <Show when={props.onConnect}>
                  {(onConnect) => (
                    <Button
                      type="button"
                      variant="secondary"
                      sx={styles.connect}
                      disabled={props.connecting?.(provider.id) ?? false}
                      onClick={() => onConnect()(provider.id)}
                    >
                      {props.connecting?.(provider.id) ? "Connecting..." : "Connect"}
                    </Button>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </section>
    </div>
  );
}
