import type { JSX } from "@solidjs/web";

import { type Package } from "@macrograph/core";
import { SchemaReference, plainDescription } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation, useParams } from "@solidjs/router";
import { httpStatus, isServer } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import {
  type PackageSummary,
  docsPath,
  findPackage,
  nodePath,
  packageCounts,
  packageLogo,
  packagePath,
  useNodeIO,
  usePackageReference,
} from "../docs/reference";

type SchemaType = Package.SchemaModel["type"];

const schemaVariants: ReadonlyArray<{ readonly type: SchemaType; readonly label: string }> = [
  { type: "event", label: "Event Nodes" },
  { type: "exec", label: "Exec Nodes" },
  { type: "pure", label: "Pure Nodes" },
  { type: "base", label: "Base Nodes" },
];

type PackageParams = { publisher: string; name: string; node?: string };

const usePackageSummary = () => {
  const params = useParams<PackageParams>();
  return createMemo(() => findPackage({ publisher: params.publisher, name: params.name }));
};

/** A package's header and node list, around its overview or one of its nodes. */
export function PackageLayout(props: { readonly children?: JSX.Element }) {
  const summary = usePackageSummary();
  return (
    <Show
      when={summary()}
      fallback={<NotFound title="Package not found" message="There's no package with this name." />}
    >
      {(summary) => <PackageShell summary={summary()}>{props.children}</PackageShell>}
    </Show>
  );
}

function PackageShell(props: {
  readonly summary: PackageSummary;
  readonly children?: JSX.Element;
}) {
  const location = useLocation();
  const reference = usePackageReference(() => props.summary.id);
  const [search, setSearch] = createSignal("");
  const groups = createMemo(() => {
    const query = search().trim().toLocaleLowerCase();
    const matches = (schema: Package.SchemaModel) =>
      query.length === 0 ||
      schema.name.toLocaleLowerCase().includes(query) ||
      (schema.description !== undefined &&
        plainDescription(schema.description).toLocaleLowerCase().includes(query));
    return schemaVariants
      .map((variant) => ({
        ...variant,
        schemas: reference()
          .schemas.filter((schema) => schema.type === variant.type && matches(schema))
          .toSorted((left, right) => left.name.localeCompare(right.name)),
      }))
      .filter((group) => group.schemas.length > 0);
  });
  const current = (href: string) =>
    decodeURIComponent(location.pathname) === decodeURIComponent(href);
  const currentLabel = createMemo(
    () =>
      reference().schemas.find((schema) => current(nodePath(props.summary, schema.id)))?.name ??
      "Overview",
  );
  // On narrow screens the node list is a menu, which closes once a page is chosen.
  const [menuOpen, setMenuOpen] = createSignal(false);
  createEffect(
    () => location.pathname,
    () => {
      setMenuOpen(false);
    },
  );

  return (
    <div sx={styles.shell}>
      <header sx={styles.packageHeader}>
        <nav aria-label="Breadcrumb" sx={styles.breadcrumb}>
          <a href={docsPath} sx={styles.breadcrumbLink}>
            Packages
          </a>
          <span aria-hidden="true">/</span>
          <span>{props.summary.publisher}</span>
          <span aria-hidden="true">/</span>
          <a href={packagePath(props.summary)} sx={styles.breadcrumbLink}>
            {props.summary.name}
          </a>
        </nav>
        <div sx={styles.titleRow}>
          <Show when={packageLogo(props.summary)}>
            {(logo) => <img src={logo()} alt="" sx={styles.packageLogo} />}
          </Show>
          <h1 sx={styles.title}>{props.summary.displayName}</h1>
        </div>
      </header>
      <div sx={styles.layout}>
        <aside sx={styles.sidebar}>
          <button
            type="button"
            aria-expanded={menuOpen() ? "true" : "false"}
            aria-controls="package-reference-menu"
            onClick={() => setMenuOpen((open) => !open)}
            sx={styles.menuButton}
          >
            <span sx={styles.menuLabel}>{currentLabel()}</span>
            <IconTablerChevronDown
              {...stylex.attrs(styles.menuIcon, menuOpen() && styles.menuIconOpen)}
            />
          </button>
          <div
            id="package-reference-menu"
            sx={[styles.panel, menuOpen() && styles.panelOpen]}
            onKeyDown={(event) => {
              if (event.key === "Escape") setMenuOpen(false);
            }}
          >
            <input
              type="search"
              aria-label={`Search ${props.summary.displayName} nodes`}
              placeholder="Search nodes"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              sx={styles.search}
            />
            <nav aria-label={`${props.summary.displayName} reference`} sx={styles.sidebarNav}>
              <a
                href={packagePath(props.summary)}
                aria-current={current(packagePath(props.summary)) ? "page" : undefined}
                sx={[styles.item, current(packagePath(props.summary)) && styles.activeItem]}
              >
                Overview
              </a>
              <For each={groups()}>
                {(group) => (
                  <section sx={styles.group}>
                    <h2 sx={styles.groupLabel}>
                      <span sx={[styles.swatch, variantColor(group.type)]} />
                      {group.label}
                    </h2>
                    <For each={group.schemas}>
                      {(schema) => (
                        <a
                          href={nodePath(props.summary, schema.id)}
                          aria-current={
                            current(nodePath(props.summary, schema.id)) ? "page" : undefined
                          }
                          sx={[
                            styles.item,
                            current(nodePath(props.summary, schema.id)) && styles.activeItem,
                          ]}
                        >
                          {schema.name}
                        </a>
                      )}
                    </For>
                  </section>
                )}
              </For>
              <Show when={groups().length === 0}>
                <p sx={styles.empty}>No matching nodes.</p>
              </Show>
            </nav>
          </div>
        </aside>
        <div sx={styles.detail}>{props.children}</div>
      </div>
    </div>
  );
}

/** Loads the package a child route belongs to; layouts only render children for known ones. */
function WithPackage(props: {
  readonly children: (pkg: () => Package.Model, summary: () => PackageSummary) => JSX.Element;
}) {
  const summary = usePackageSummary();
  return (
    <Show when={summary()}>
      {(summary) => <PackageData summary={summary()}>{props.children}</PackageData>}
    </Show>
  );
}

function PackageData(props: {
  readonly summary: PackageSummary;
  readonly children: (pkg: () => Package.Model, summary: () => PackageSummary) => JSX.Element;
}) {
  const reference = usePackageReference(() => props.summary.id);
  return <>{props.children(reference, () => props.summary)}</>;
}

export function PackageOverviewRoute() {
  return (
    <WithPackage>
      {(pkg, summary) => (
        <div sx={styles.overview}>
          <p sx={[styles.lead, summary().description === undefined && styles.missing]}>
            {summary().description ?? "No description provided."}
          </p>
          <dl sx={styles.facts}>
            <dt sx={styles.factLabel}>Package</dt>
            <dd sx={styles.factValue}>
              <code sx={styles.code}>
                {summary().publisher}/{summary().name}
              </code>
            </dd>
            <dt sx={styles.factLabel}>Source</dt>
            <dd sx={styles.factValue}>
              <code sx={styles.code}>{summary().source}</code>
            </dd>
            <dt sx={styles.factLabel}>Contents</dt>
            <dd sx={styles.factValue}>{packageCounts(summary())}</dd>
          </dl>
          <Show when={pkg().resources.length > 0}>
            <section sx={styles.section}>
              <h2 sx={styles.sectionTitle}>Resources</h2>
              <p sx={styles.sectionLead}>
                Connections and accounts that this package's nodes act on. Choose one when adding a
                node that needs it.
              </p>
              <ul sx={styles.resources}>
                <For each={pkg().resources}>
                  {(resource) => (
                    <li sx={styles.resource}>
                      <div sx={styles.resourceName}>{resource.name}</div>
                      <p
                        sx={[
                          styles.resourceDescription,
                          resource.description === undefined && styles.missing,
                        ]}
                      >
                        {resource.description ?? "No description provided."}
                      </p>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>
        </div>
      )}
    </WithPackage>
  );
}

export function NodeReferenceRoute() {
  const params = useParams<PackageParams>();
  return (
    <WithPackage>
      {(pkg, summary) => {
        const schema = createMemo(() =>
          pkg().schemas.find((candidate) => candidate.id === params.node),
        );
        const generateIO = useNodeIO(
          () => summary().id,
          () => pkg().types ?? {},
        );
        return (
          <Show
            when={schema()}
            fallback={
              <NotFound
                title="Node not found"
                message={`${summary().displayName} has no node with this name.`}
              />
            }
          >
            {(schema) => (
              <div sx={styles.node}>
                <SchemaReference
                  package={pkg()}
                  schema={schema()}
                  definitions={pkg().types ?? {}}
                  generateIO={generateIO}
                />
              </div>
            )}
          </Show>
        );
      }}
    </WithPackage>
  );
}

function NotFound(props: { readonly title: string; readonly message: string }) {
  if (isServer) httpStatus(404);
  return (
    <main sx={styles.notFound}>
      <h1 sx={styles.title}>{props.title}</h1>
      <p sx={styles.lead}>
        {props.message}{" "}
        <a href={docsPath} sx={styles.inlineLink}>
          Browse all packages
        </a>
      </p>
    </main>
  );
}

const variantColor = (type: SchemaType) =>
  type === "event"
    ? styles.eventBackground
    : type === "exec"
      ? styles.execBackground
      : type === "pure"
        ? styles.pureBackground
        : styles.baseBackground;

const md = "@media (min-width: 768px)";
const styles = stylex.create({
  shell: {
    width: "100%",
    maxWidth: 1280,
    boxSizing: "border-box",
    marginInline: "auto",
    paddingInline: { default: 12, [md]: 24 },
  },
  packageHeader: {
    paddingTop: { default: 16, [md]: 32 },
    paddingBottom: { default: 0, [md]: 20 },
    borderBottomColor: colors.gray4,
    borderBottomStyle: { default: "none", [md]: "solid" },
    borderBottomWidth: 1,
  },
  breadcrumb: {
    display: "flex",
    gap: 6,
    fontSize: { default: 12, [md]: 13 },
    color: colors.gray9,
  },
  breadcrumbLink: {
    color: { default: colors.gray10, ":hover": colors.gray12 },
    textDecoration: "none",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: { default: 8, [md]: 12 },
    marginTop: { default: 6, [md]: 12 },
  },
  packageLogo: {
    width: { default: 24, [md]: 36 },
    height: { default: 24, [md]: 36 },
    borderRadius: { default: 6, [md]: 8 },
    objectFit: "contain",
  },
  title: {
    margin: 0,
    fontSize: { default: 20, [md]: 28 },
    fontWeight: 700,
    letterSpacing: "-0.025em",
  },
  layout: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr)", [md]: "240px minmax(0, 1fr)" },
    alignItems: "start",
  },
  sidebar: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxHeight: { default: null, [md]: "100dvh" },
    boxSizing: "border-box",
    marginInline: { default: -12, [md]: 0 },
    paddingBlock: { default: 12, [md]: 16 },
    paddingInline: { default: 12, [md]: 0 },
    paddingInlineEnd: { default: 12, [md]: 16 },
    backgroundColor: colors.gray1,
    borderRightColor: colors.gray4,
    borderRightStyle: { default: "none", [md]: "solid" },
    borderRightWidth: 1,
    borderBottomColor: colors.gray4,
    borderBottomStyle: { default: "solid", [md]: "none" },
    borderBottomWidth: 1,
  },
  menuButton: {
    display: { default: "flex", [md]: "none" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    height: 34,
    boxSizing: "border-box",
    paddingInline: 10,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: colors.gray2,
    color: colors.gray12,
    fontSize: 13,
    fontWeight: 500,
  },
  menuLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  menuIcon: {
    flexShrink: 0,
    width: 16,
    height: 16,
    color: colors.gray10,
    transitionProperty: "transform",
    transitionDuration: "150ms",
  },
  menuIconOpen: { transform: "rotate(180deg)" },
  panel: {
    display: { default: "none", [md]: "flex" },
    flexDirection: "column",
    gap: { default: 8, [md]: 12 },
    position: { default: "absolute", [md]: "static" },
    top: "100%",
    insetInline: 12,
    flex: { default: null, [md]: 1 },
    minHeight: 0,
    maxHeight: { default: "min(70dvh, 520px)", [md]: null },
    marginTop: { default: 4, [md]: 0 },
    padding: { default: 8, [md]: 0 },
    borderColor: colors.gray5,
    borderStyle: { default: "solid", [md]: "none" },
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: { default: colors.gray2, [md]: "transparent" },
    boxShadow: { default: "0 12px 32px rgb(0 0 0 / 0.5)", [md]: "none" },
  },
  panelOpen: { display: "flex" },
  search: {
    flexShrink: 0,
    width: "100%",
    height: 32,
    boxSizing: "border-box",
    paddingInline: 10,
    borderColor: { default: colors.gray5, ":focus": colors.focus },
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    outline: "none",
    backgroundColor: { default: colors.gray1, [md]: colors.gray2 },
    color: colors.gray12,
    fontSize: 13,
  },
  sidebarNav: { minHeight: 0, overflowY: "auto" },
  group: { marginTop: { default: 12, [md]: 16 } },
  groupLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    marginBottom: 4,
    paddingInline: 8,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: colors.gray9,
  },
  swatch: { flexShrink: 0, width: 8, height: 8, borderRadius: 2 },
  item: {
    display: "block",
    paddingBlock: 5,
    paddingInline: 8,
    borderRadius: 5,
    overflow: "hidden",
    fontSize: 13,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    textDecoration: "none",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  activeItem: {
    color: colors.gray12,
    backgroundColor: { default: colors.gray4, ":hover": colors.gray4 },
    fontWeight: 500,
  },
  empty: { margin: 0, marginTop: 12, paddingInline: 8, fontSize: 12, color: colors.gray9 },
  detail: {
    minWidth: 0,
    paddingTop: { default: 16, [md]: 24 },
    paddingInlineStart: { default: 0, [md]: 32 },
    paddingBottom: { default: 48, [md]: 96 },
  },
  overview: { maxWidth: 720 },
  lead: {
    margin: 0,
    fontSize: { default: 14, [md]: 15 },
    lineHeight: { default: "22px", [md]: "24px" },
    color: colors.gray11,
  },
  missing: { fontStyle: "italic", color: colors.gray9 },
  facts: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: 24,
    rowGap: 8,
    margin: 0,
    marginTop: 24,
    fontSize: 13,
  },
  factLabel: { color: colors.gray9 },
  factValue: { margin: 0, color: colors.gray11 },
  code: {
    paddingBlock: 1,
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: colors.gray3,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
  },
  section: { marginTop: 40 },
  sectionTitle: { margin: 0, fontSize: 18, fontWeight: 600 },
  sectionLead: { margin: 0, marginTop: 6, fontSize: 13, color: colors.gray10 },
  resources: { display: "grid", gap: 8, margin: 0, marginTop: 16, padding: 0, listStyle: "none" },
  resource: {
    padding: 12,
    borderColor: colors.gray4,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray2,
  },
  resourceName: { fontSize: 14, fontWeight: 600 },
  resourceDescription: { margin: 0, marginTop: 4, fontSize: 13, color: colors.gray11 },
  node: { maxWidth: 760 },
  notFound: { paddingBlock: { default: 24, [md]: 48 } },
  inlineLink: { color: colors.gray12, textDecoration: "underline" },
  eventBackground: { backgroundColor: colors.event },
  execBackground: { backgroundColor: colors.execution },
  pureBackground: { backgroundColor: colors.pure },
  baseBackground: { backgroundColor: colors.base },
});
