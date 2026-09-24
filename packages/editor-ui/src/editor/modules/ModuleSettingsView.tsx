import type { ClientSettings } from "@macrograph/module";
import type { JSX } from "@solidjs/web";

import {
  BuiltinAuthoring,
  Clipboard,
  Function as GraphFunction,
  Node,
  NodeId,
  type NodeIO,
  type Package,
  type SchemaAuthoring,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import * as stylex from "@stylexjs/stylex";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Result } from "effect";
import { For, Loading, Show, createMemo, createSignal, onCleanup } from "solid-js";

import type { PackageViewState } from "../workspace/workspace";

import { colors } from "../../tokens.stylex.ts";
import { DataTypePicker } from "../../ui/DataTypePicker";
import { LoadingState } from "../../ui/LoadingState";
import { SearchInput } from "../catalog/SearchInput";
import {
  GraphNode,
  graphNodeHeight,
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
} from "../graph/GraphNode";
import { PropertyControl } from "../inspector/PropertyControl";

const styles = stylex.create({
  root: {
    backgroundColor: colors.gray2,
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
  },
  tabs: {
    backgroundColor: "transparent",
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    boxSizing: "border-box",
    display: "flex",
    flexShrink: 0,
    height: 32,
    marginInlineEnd: 12,
    maxHeight: 32,
    minHeight: 32,
    overflow: "hidden",
  },
  tab: {
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.gray4 },
      ":disabled": "transparent",
    },
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    fontSize: 11,
    fontWeight: 500,
    minWidth: 72,
    outline: "none",
    opacity: { default: 1, ":disabled": 0.5 },
    paddingInline: 12,
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  activeTab: { borderBottomColor: colors.focus, color: colors.gray12 },
  inactiveTab: {
    borderBottomColor: "transparent",
    color: {
      default: colors.gray10,
      ":hover": { default: null, "@media (hover: hover)": colors.gray12 },
    },
  },
  scroll: { flex: 1, minHeight: 0, overflow: "hidden" },
  engineScroll: { height: "100%", overflowY: "auto" },
  fullHeight: { height: "100%" },
  content: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 672,
    padding: 12,
    width: "100%",
  },
  referenceLayout: {
    display: "grid",
    gridTemplateColumns: "220px minmax(0, 1fr)",
    height: "100%",
    minHeight: 0,
  },
  referenceSidebar: {
    borderRightColor: colors.gray5,
    borderRightStyle: "solid",
    borderRightWidth: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  referenceSearch: {
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    boxSizing: "border-box",
    display: "flex",
    flexShrink: 0,
    height: 32,
    maxHeight: 32,
    minHeight: 32,
    overflow: "hidden",
  },
  referenceNav: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    minHeight: 0,
    overflowY: "auto",
  },
  referenceGroup: { display: "flex", flexDirection: "column", gap: 0 },
  referenceVariantGroup: {
    borderTopColor: colors.gray5,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
    display: "flex",
    flexDirection: "column",
  },
  referenceVariantLabel: {
    alignItems: "center",
    backgroundColor: colors.gray3,
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    color: colors.gray11,
    display: "flex",
    fontSize: 10,
    fontWeight: 600,
    gap: 6,
    marginTop: 0,
    paddingBlock: 5,
    paddingInline: 8,
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  referenceItem: {
    alignItems: "center",
    color: colors.gray11,
    display: "flex",
    fontSize: 12,
    gap: 7,
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: "left",
    width: "100%",
  },
  referenceEmpty: {
    color: colors.gray9,
    fontSize: 11,
    paddingBlock: 12,
    paddingInline: 8,
  },
  selectedReferenceItem: {
    backgroundColor: {
      default: colors.gray4,
      ":hover": { default: null, "@media (hover: hover)": colors.gray5 },
    },
    boxShadow: `inset -2px 0 0 ${colors.focus}`,
    color: colors.gray12,
  },
  unselectedReferenceItem: {
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.gray4 },
    },
  },
  referenceDetail: { minHeight: 0, overflowY: "auto", padding: 20 },
  detailContent: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 },
  detailHeader: { display: "flex", flexDirection: "column", gap: 5 },
  detailTitleRow: { alignItems: "center", display: "flex", gap: 8 },
  detailTitle: { color: colors.gray12, fontSize: 18, fontWeight: 600 },
  typeBadge: {
    backgroundColor: colors.gray4,
    borderRadius: 4,
    color: colors.gray11,
    fontSize: 10,
    paddingBlock: 2,
    paddingInline: 5,
    textTransform: "capitalize",
  },
  detailDescription: { color: colors.gray10, fontSize: 12, lineHeight: 1.5 },
  missingDescription: { fontStyle: "italic" },
  nodeConfiguration: {
    alignItems: "start",
    display: "grid",
    gap: 24,
    gridTemplateColumns: "max-content minmax(190px, 240px)",
  },
  detailSection: { display: "flex", flexDirection: "column", gap: 9, minWidth: 0 },
  detailSectionTitle: { color: colors.gray12, fontSize: 12, fontWeight: 600 },
  configuration: { display: "flex", flexDirection: "column", gap: 16, minWidth: 0 },
  preview: {
    position: "relative",
  },
  properties: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  },
  propertyNote: { color: colors.gray10, fontSize: 11, lineHeight: 1.4 },
  emptyDetail: {
    alignItems: "center",
    color: colors.gray10,
    display: "flex",
    fontSize: 12,
    height: "100%",
    justifyContent: "center",
  },
  message: { color: colors.gray11, fontSize: 12, marginTop: 4 },
  warning: { color: "var(--amber-10)" },
  nodeName: { color: colors.gray12, fontSize: 13, fontWeight: 500 },
  nodeDescription: { color: colors.gray10, fontSize: 12, lineHeight: 1.4 },
  eventColor: { color: colors.event },
  execColor: { color: colors.execution },
  pureColor: { color: colors.pure },
  baseColor: { color: colors.base },
  eventBackground: { backgroundColor: colors.event },
  execBackground: { backgroundColor: colors.execution },
  pureBackground: { backgroundColor: colors.pure },
  baseBackground: { backgroundColor: colors.base },
  nodeTypeBadge: { color: "white" },
  variantLabelSwatch: {
    backgroundColor: "currentColor",
    borderRadius: 2,
    height: 10,
    width: 3,
  },
});

type SchemaModel = Package.SchemaModel;
type SchemaType = SchemaModel["type"];
type PreviewValue = string | number | boolean | null;

const schemaVariants: ReadonlyArray<{ type: SchemaType; label: string }> = [
  { type: "event", label: "Event Nodes" },
  { type: "exec", label: "Exec Nodes" },
  { type: "pure", label: "Pure Nodes" },
  { type: "base", label: "Base Nodes" },
];

const schemaColor = (type: SchemaType) =>
  type === "event"
    ? styles.eventColor
    : type === "exec"
      ? styles.execColor
      : type === "pure"
        ? styles.pureColor
        : styles.baseColor;

const schemaBackground = (type: SchemaType) =>
  type === "event"
    ? styles.eventBackground
    : type === "exec"
      ? styles.execBackground
      : type === "pure"
        ? styles.pureBackground
        : styles.baseBackground;

const propertyDefault = (property: Package.PropertyDefinition): PreviewValue => {
  if (!("type" in property)) return null;
  if (
    typeof property.defaultValue === "string" ||
    typeof property.defaultValue === "number" ||
    typeof property.defaultValue === "boolean"
  )
    return property.defaultValue;
  if (property.type._tag === "String") return "";
  if (property.type._tag === "Bool") return false;
  return 0;
};

const collectWildcardIds = (type: DataType.Any, ids: Set<string>) => {
  if (type._tag === "Wildcard") ids.add(type.id);
  if (type._tag === "List") collectWildcardIds(type.item, ids);
  if (type._tag === "Option") collectWildcardIds(type.inner, ids);
};

const resolveWildcards = (
  type: DataType.Any,
  values: Readonly<Record<string, DataType.Any>>,
): DataType.Any => {
  if (type._tag === "Wildcard") return values[type.id] ?? DataType.String;
  if (type._tag === "List") return DataType.List(resolveWildcards(type.item, values));
  if (type._tag === "Option") return DataType.Option(resolveWildcards(type.inner, values));
  return type;
};

function ReferenceView(props: {
  package: Package.Model;
  schemas: ReadonlyArray<SchemaModel>;
  definitions: DataType.Definitions;
  functions: ReadonlyArray<GraphFunction.Model>;
  authoring: SchemaAuthoring.Registry;
  selection: string | null;
  onSelectionChange: (selection: string) => void;
}) {
  const [search, setSearch] = createSignal("");
  const [propertyValues, setPropertyValues] = createSignal<
    Readonly<Record<string, Readonly<Record<string, PreviewValue>>>>
  >({});
  const [wildcardValues, setWildcardValues] = createSignal<
    Readonly<Record<string, Readonly<Record<string, DataType.Any>>>>
  >({});
  const [previewSelected, setPreviewSelected] = createSignal(false);
  let previewElement: HTMLDivElement | undefined;
  const normalizedSearch = createMemo(() => search().trim().toLocaleLowerCase());
  const matchesSearch = (name: string, description?: string) => {
    const query = normalizedSearch();
    return (
      query.length === 0 ||
      name.toLocaleLowerCase().includes(query) ||
      description?.toLocaleLowerCase().includes(query) === true
    );
  };
  const nodeGroups = createMemo(() =>
    schemaVariants
      .map((variant) => ({
        ...variant,
        schemas: props.schemas.filter(
          (schema) =>
            schema.type === variant.type && matchesSearch(schema.name, schema.description),
        ),
      }))
      .filter((group) => group.schemas.length > 0),
  );
  const filteredResources = createMemo(() =>
    props.package.resources.filter((resource) =>
      matchesSearch(resource.name, resource.description),
    ),
  );
  const hasSearchResults = createMemo(
    () => nodeGroups().length > 0 || filteredResources().length > 0,
  );
  const selectedKey = createMemo(() => {
    const selectionExists =
      (props.selection?.startsWith("node:") &&
        props.schemas.some((schema) => schema.id === props.selection?.slice(5))) ||
      (props.selection?.startsWith("resource:") &&
        props.package.resources.some((resource) => resource.id === props.selection?.slice(9)));
    if (selectionExists) return props.selection;
    return props.schemas[0] !== undefined
      ? `node:${props.schemas[0].id}`
      : props.package.resources[0] !== undefined
        ? `resource:${props.package.resources[0].id}`
        : null;
  });
  const selectedSchema = createMemo(() => {
    const key = selectedKey();
    return key?.startsWith("node:")
      ? props.schemas.find((schema) => schema.id === key.slice(5))
      : undefined;
  });
  const selectedResource = createMemo(() => {
    const key = selectedKey();
    return key?.startsWith("resource:")
      ? props.package.resources.find((resource) => resource.id === key.slice(9))
      : undefined;
  });
  const values = createMemo(() => {
    const schema = selectedSchema();
    if (schema === undefined) return {};
    return Object.fromEntries(
      schema.properties.map((property) => [
        property.id,
        propertyValues()[schema.id]?.[property.id] ?? propertyDefault(property),
      ]),
    );
  });
  const wildcardIds = createMemo(() => {
    const schema = selectedSchema();
    if (schema === undefined) return [];
    const ids = new Set<string>();
    for (const port of [...schema.dataInputs, ...schema.dataOutputs])
      collectWildcardIds(port.type, ids);
    for (const port of [...schema.executionInputs, ...schema.executionOutputs])
      for (const field of port.scope ?? []) collectWildcardIds(field.type, ids);
    return [...ids];
  });
  const previewIO = createMemo<NodeIO | undefined>(() => {
    const schema = selectedSchema();
    if (schema === undefined) return undefined;
    const functionProperty = schema.properties.find((property) => "function" in property);
    const functionId = functionProperty === undefined ? undefined : values()[functionProperty.id];
    const functionIO =
      typeof functionId === "string"
        ? GraphFunction.callIO(
            props.functions.find((candidate) => candidate.canvas.id === functionId),
          )
        : undefined;
    const declared = functionIO === undefined ? schema : { ...schema, ...functionIO };
    const selectedValues = wildcardValues()[schema.id] ?? {};
    const generated = props.authoring
      .get({ package: props.package.id, schema: schema.id })
      ?.generateIO?.({
        declared,
        properties: values(),
        definitions: props.definitions,
        resolve: (type) => resolveWildcards(type, selectedValues),
        inputScope: () => undefined,
      });
    const preview =
      generated !== undefined && Result.isSuccess(generated) ? generated.success : declared;
    const resolveDataPort = (port: SchemaModel["dataInputs"][number]) => ({
      ...port,
      type: resolveWildcards(port.type, selectedValues),
    });
    const resolveExecutionPort = (port: SchemaModel["executionInputs"][number]) => ({
      ...port,
      scope:
        port.scope?.map((field) => ({
          ...field,
          type: resolveWildcards(field.type, selectedValues),
        })) ?? port.scope,
    });
    return {
      dataInputs: preview.dataInputs.map(resolveDataPort),
      dataOutputs: preview.dataOutputs.map(resolveDataPort),
      executionInputs: preview.executionInputs.map(resolveExecutionPort),
      executionOutputs: preview.executionOutputs.map(resolveExecutionPort),
    };
  });
  const previewNode = createMemo<Node.Model | undefined>(() => {
    const schema = selectedSchema();
    if (schema === undefined) return undefined;
    return {
      id: NodeId.make("module-reference-preview"),
      name: schema.name,
      properties: values(),
      inputDefaults: {},
      foldPins: false,
      schema: { package: props.package.id, schema: schema.id },
      position: { x: 0, y: 0 },
    };
  });
  const copyPreview = (event: ClipboardEvent) => {
    const node = previewNode();
    const schema = selectedSchema();
    if (!previewSelected() || node === undefined || schema === undefined) return;
    const io = previewIO();
    const text = JSON.stringify({
      format: "macrograph/nodes",
      version: 1,
      nodes: [node],
      connections: [],
      externalConnections: [],
      nodeIO: io === undefined ? {} : { [node.id]: io },
      nodeSchemas: {
        [node.id]: { moduleName: props.package.name, schemaName: schema.name },
      },
    } satisfies Clipboard.Fragment);
    if (event.clipboardData === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  };
  const previewHeight = createMemo(() => {
    const io = previewIO();
    return io === undefined ? 0 : graphNodeHeight(graphNodeInputs(io), graphNodeOutputs(io));
  });
  const previewWidth = createMemo(() => {
    const schema = selectedSchema();
    return schema === undefined ? 0 : graphNodeWidth(previewIO(), schema.name);
  });
  const setProperty = (schemaId: string, propertyId: string, value: PreviewValue) =>
    setPropertyValues((current) => ({
      ...current,
      [schemaId]: { ...current[schemaId], [propertyId]: value },
    }));
  const clearProperty = (schemaId: string, propertyId: string) =>
    setPropertyValues((current) => {
      const nextSchema = { ...current[schemaId] };
      delete nextSchema[propertyId];
      return { ...current, [schemaId]: nextSchema };
    });
  const setWildcard = (schemaId: string, wildcardId: string, value: DataType.Any) =>
    setWildcardValues((current) => ({
      ...current,
      [schemaId]: { ...current[schemaId], [wildcardId]: value },
    }));

  return (
    <div sx={styles.referenceLayout}>
      <aside sx={styles.referenceSidebar}>
        <div sx={styles.referenceSearch}>
          <SearchInput value={search()} placeholder="Search reference" onChange={setSearch} />
        </div>
        <nav aria-label={`${props.package.name} reference`} sx={styles.referenceNav}>
          <Show when={hasSearchResults()}>
            <section sx={styles.referenceGroup}>
              <Show when={filteredResources().length > 0}>
                <section sx={styles.referenceVariantGroup}>
                  <h4 sx={styles.referenceVariantLabel}>Resources</h4>
                  <For each={filteredResources()}>
                    {(resource) => (
                      <button
                        type="button"
                        aria-pressed={
                          selectedKey() === `resource:${resource.id}` ? "true" : "false"
                        }
                        sx={[
                          styles.referenceItem,
                          selectedKey() === `resource:${resource.id}`
                            ? styles.selectedReferenceItem
                            : styles.unselectedReferenceItem,
                        ]}
                        onClick={() => props.onSelectionChange(`resource:${resource.id}`)}
                      >
                        {resource.name}
                      </button>
                    )}
                  </For>
                </section>
              </Show>
              <For each={nodeGroups()}>
                {(group) => (
                  <section sx={styles.referenceVariantGroup}>
                    <h4 sx={styles.referenceVariantLabel}>
                      <span sx={[styles.variantLabelSwatch, schemaColor(group.type)]} />
                      {group.label}
                    </h4>
                    <For each={group.schemas}>
                      {(schema) => (
                        <button
                          type="button"
                          aria-pressed={selectedKey() === `node:${schema.id}` ? "true" : "false"}
                          sx={[
                            styles.referenceItem,
                            selectedKey() === `node:${schema.id}`
                              ? styles.selectedReferenceItem
                              : styles.unselectedReferenceItem,
                          ]}
                          onClick={() => props.onSelectionChange(`node:${schema.id}`)}
                        >
                          {schema.name}
                        </button>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </section>
          </Show>
          <Show when={!hasSearchResults()}>
            <div sx={styles.referenceEmpty}>No matching nodes or resources.</div>
          </Show>
        </nav>
      </aside>
      <main sx={styles.referenceDetail}>
        <Show when={selectedSchema()}>
          {(schema) => (
            <div sx={styles.detailContent}>
              <header sx={styles.detailHeader}>
                <div sx={styles.detailTitleRow}>
                  <h2 sx={styles.detailTitle}>{schema().name}</h2>
                  <span
                    sx={[styles.typeBadge, styles.nodeTypeBadge, schemaBackground(schema().type)]}
                  >
                    {schema().type}
                  </span>
                </div>
                <p
                  sx={[
                    styles.detailDescription,
                    schema().description === undefined ? styles.missingDescription : null,
                  ]}
                >
                  {schema().description ?? "No description provided."}
                </p>
              </header>
              <div sx={styles.nodeConfiguration}>
                <div
                  ref={previewElement}
                  sx={styles.preview}
                  style={{ height: `${previewHeight()}px`, width: `${previewWidth()}px` }}
                  tabindex={-1}
                  onCopy={copyPreview}
                >
                  <Show when={previewNode()}>
                    {(node) => (
                      <GraphNode
                        node={node()}
                        schema={schema()}
                        io={previewIO()}
                        definitions={props.definitions}
                        allowInputDefaults={false}
                        connectedInputIds={new Set()}
                        connectedOutputIds={new Set()}
                        selected={previewSelected()}
                        onSelect={() => {
                          setPreviewSelected(true);
                          previewElement?.focus();
                        }}
                        onDragStart={() => undefined}
                        onPortPointerDown={() => undefined}
                        onDisconnect={() => undefined}
                        onContextMenu={() => undefined}
                        onExpand={() => undefined}
                        onSetInputDefault={() => undefined}
                        onClearInputDefault={() => undefined}
                        onGetSuggestions={async () => []}
                      />
                    )}
                  </Show>
                </div>
                <div sx={styles.configuration}>
                  <Show when={wildcardIds().length > 0}>
                    <section sx={styles.detailSection}>
                      <h3 sx={styles.detailSectionTitle}>Wildcards</h3>
                      <div sx={styles.properties}>
                        <For each={wildcardIds()}>
                          {(wildcardId) => (
                            <label sx={styles.detailSection}>
                              <span sx={styles.propertyNote}>{wildcardId}</span>
                              <DataTypePicker
                                label={`${wildcardId} wildcard type`}
                                value={
                                  wildcardValues()[schema().id]?.[wildcardId] ?? DataType.String
                                }
                                definitions={props.definitions}
                                onChange={(value) => setWildcard(schema().id, wildcardId, value)}
                              />
                            </label>
                          )}
                        </For>
                      </div>
                    </section>
                  </Show>
                  <Show when={schema().properties.length > 0}>
                    <section sx={styles.detailSection}>
                      <h3 sx={styles.detailSectionTitle}>Properties</h3>
                      <div sx={styles.properties}>
                        <For each={schema().properties}>
                          {(property) => (
                            <Show
                              when={"resource" in property ? undefined : property}
                              fallback={
                                <div>
                                  <div sx={styles.nodeName}>{property.name}</div>
                                  <p sx={styles.propertyNote}>
                                    {property.description ??
                                      ("resource" in property
                                        ? `Select a ${property.resource} resource when adding this node.`
                                        : undefined)}
                                  </p>
                                </div>
                              }
                            >
                              {(valueProperty) => (
                                <PropertyControl
                                  property={valueProperty()}
                                  functions={props.functions}
                                  value={values()[property.id]}
                                  onSet={(value) => {
                                    if (
                                      value === null ||
                                      typeof value === "string" ||
                                      typeof value === "number" ||
                                      typeof value === "boolean"
                                    )
                                      setProperty(schema().id, property.id, value);
                                  }}
                                  onClear={() => clearProperty(schema().id, property.id)}
                                />
                              )}
                            </Show>
                          )}
                        </For>
                      </div>
                    </section>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
        <Show when={selectedResource()}>
          {(resource) => (
            <div sx={styles.detailContent}>
              <header sx={styles.detailHeader}>
                <div sx={styles.detailTitleRow}>
                  <h2 sx={styles.detailTitle}>{resource().name}</h2>
                  <span sx={styles.typeBadge}>Resource</span>
                </div>
                <p
                  sx={[
                    styles.detailDescription,
                    resource().description === undefined ? styles.missingDescription : null,
                  ]}
                >
                  {resource().description ?? "No description provided."}
                </p>
              </header>
              <section sx={styles.detailSection}>
                <h3 sx={styles.detailSectionTitle}>Resource ID</h3>
                <p sx={styles.propertyNote}>{resource().id}</p>
              </section>
            </div>
          )}
        </Show>
        <Show when={selectedKey() === null}>
          <div sx={styles.emptyDetail}>This module does not expose nodes or resources.</div>
        </Show>
      </main>
    </div>
  );
}

export interface ModuleSettingsData {
  readonly endpoints: ReadonlyArray<ClientSettings.Endpoint>;
  readonly capabilities: ReadonlySet<string>;
}

function ConnectedModuleSettings(props: {
  settings: ClientSettings.Connected<JSX.Element>;
  state: () => unknown;
  endpoints: ReadonlyArray<ClientSettings.Endpoint>;
  onChanged: () => Promise<void>;
}) {
  const view = createMemo(() =>
    props.settings.render(props.state, {
      get endpoints() {
        return props.endpoints;
      },
      get onChanged() {
        return props.onChanged;
      },
    }),
  );
  return <>{view()}</>;
}

export function ModuleSettingsView(props: {
  package: Package.Model;
  definitions?: DataType.Definitions;
  functions?: ReadonlyArray<GraphFunction.Model>;
  authoring?: SchemaAuthoring.Registry;
  settings?: ClientSettings.Connected<JSX.Element> | undefined;
  data: ModuleSettingsData;
  state: () => unknown;
  requireCapability?: boolean;
  onChanged: () => Promise<void>;
  view: PackageViewState;
  onViewChange: (view: PackageViewState) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { networkMode: "always" } },
  });
  onCleanup(() => queryClient.clear());
  const hasEngineSettings = createMemo(
    () =>
      props.settings !== undefined &&
      (!props.requireCapability || props.data.capabilities.has(props.package.id)),
  );
  const selectedTab = createMemo(() =>
    props.view.selectedView === "engine" && !hasEngineSettings()
      ? "reference"
      : props.view.selectedView,
  );
  const exposedSchemas = createMemo(() =>
    props.package.schemas.filter((schema) => schema.internal !== true),
  );

  return (
    <div sx={styles.root}>
      <div role="tablist" aria-label={`${props.package.name} module views`} sx={styles.tabs}>
        <For each={["engine", "reference"] as const}>
          {(value) => (
            <button
              type="button"
              role="tab"
              aria-selected={selectedTab() === value ? "true" : "false"}
              disabled={value === "engine" && !hasEngineSettings()}
              sx={[styles.tab, selectedTab() === value ? styles.activeTab : styles.inactiveTab]}
              onClick={() => props.onViewChange({ ...props.view, selectedView: value })}
            >
              {value === "engine" ? "Engine" : "Reference"}
            </button>
          )}
        </For>
      </div>
      <div sx={styles.scroll}>
        <Show when={selectedTab() === "engine"}>
          <div sx={styles.engineScroll}>
            <Loading
              fallback={<LoadingState label="Loading module settings" style={styles.fullHeight} />}
            >
              <div sx={styles.content}>
                <Show
                  when={props.settings}
                  fallback={
                    <div>
                      <p sx={styles.message}>This module has no configurable editor settings.</p>
                    </div>
                  }
                >
                  {(settings) => (
                    <Show
                      when={
                        !props.requireCapability || props.data.capabilities.has(props.package.id)
                      }
                      fallback={
                        <div>
                          <p sx={[styles.message, styles.warning]}>
                            Settings are unavailable because this module is not hosted by the
                            current editor runtime.
                          </p>
                        </div>
                      }
                    >
                      <QueryClientProvider client={queryClient}>
                        <ConnectedModuleSettings
                          settings={settings()}
                          state={props.state}
                          endpoints={props.data.endpoints}
                          onChanged={props.onChanged}
                        />
                      </QueryClientProvider>
                    </Show>
                  )}
                </Show>
              </div>
            </Loading>
          </div>
        </Show>
        <Show when={selectedTab() === "reference"}>
          <ReferenceView
            package={props.package}
            schemas={exposedSchemas()}
            definitions={props.definitions ?? {}}
            functions={props.functions ?? []}
            authoring={props.authoring ?? BuiltinAuthoring.registry}
            selection={props.view.selectedReferenceKey}
            onSelectionChange={(selectedReferenceKey) =>
              props.onViewChange({ ...props.view, selectedReferenceKey })
            }
          />
        </Show>
      </div>
    </div>
  );
}
