import {
  Clipboard,
  Function as GraphFunction,
  type Node,
  NodeId,
  type NodeIO,
  type Package,
  type PackageId,
} from "@macrograph/core";
import { t } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createMemo, createSignal } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { DataTypePicker } from "../../ui/DataTypePicker";
import { Description } from "../../ui/Description";
import {
  GraphNode,
  graphNodeHeight,
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
} from "../graph/GraphNode";
import { PropertyControl } from "../inspector/PropertyControl";

const styles = stylex.create({
  content: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 },
  header: { display: "flex", flexDirection: "column", gap: 5 },
  titleRow: { alignItems: "center", display: "flex", gap: 8 },
  title: { color: colors.gray12, fontSize: 18, fontWeight: 600, margin: 0 },
  typeBadge: {
    borderRadius: 4,
    color: "white",
    fontSize: 10,
    paddingBlock: 2,
    paddingInline: 5,
    textTransform: "capitalize",
  },
  description: { color: colors.gray10, fontSize: 12, lineHeight: 1.5, margin: 0 },
  missingDescription: { fontStyle: "italic" },
  configuration: { alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 24 },
  preview: { flexShrink: 0, outline: "none", position: "relative" },
  controls: {
    display: "flex",
    flex: "1 1 190px",
    flexDirection: "column",
    gap: 16,
    maxWidth: 240,
    minWidth: 0,
  },
  section: { display: "flex", flexDirection: "column", gap: 9, minWidth: 0 },
  sectionTitle: { color: colors.gray12, fontSize: 12, fontWeight: 600, margin: 0 },
  properties: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  },
  propertyName: { color: colors.gray12, fontSize: 13, fontWeight: 500 },
  note: { color: colors.gray10, fontSize: 11, lineHeight: 1.4, margin: 0 },
  eventBackground: { backgroundColor: colors.event },
  execBackground: { backgroundColor: colors.execution },
  pureBackground: { backgroundColor: colors.pure },
  baseBackground: { backgroundColor: colors.base },
});

type PreviewValue = string | number | boolean | null;

const schemaBackground = (type: Package.SchemaModel["type"]) =>
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

const collectWildcardIds = (type: t.Type, ids: Set<string>) => {
  if (type._tag === "Wildcard") ids.add(type.id);
  if (type._tag === "List") collectWildcardIds(type.item, ids);
  if (type._tag === "Option") collectWildcardIds(type.inner, ids);
};

const resolveWildcards = (type: t.Type, values: Readonly<Record<string, t.Type>>): t.Type => {
  if (type._tag === "Wildcard") return values[type.id] ?? t.String;
  if (type._tag === "List") return t.List(resolveWildcards(type.item, values));
  if (type._tag === "Option") return t.Option(resolveWildcards(type.inner, values));
  return type;
};

export interface SchemaReferenceIOInput {
  readonly schema: Package.SchemaModel;
  /** The schema's declared IO, or a function call's IO when a function is selected. */
  readonly declared: NodeIO;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly resolve: (type: t.Type) => t.Type;
}

/**
 * One schema's reference: its description, a preview node that can be copied into a graph, and
 * controls for the wildcards and properties that shape its IO. Previews start from the layout
 * estimate so server-rendered pages don't reflow once the node measures itself.
 */
export function SchemaReference(props: {
  readonly package: { readonly id: PackageId; readonly name: string };
  readonly schema: Package.SchemaModel;
  readonly definitions: t.Definitions;
  readonly functions?: ReadonlyArray<GraphFunction.Model>;
  /** IO for the chosen properties; `undefined` previews the declared IO. */
  readonly generateIO?: (input: SchemaReferenceIOInput) => NodeIO | undefined;
}) {
  const [propertyValues, setPropertyValues] = createSignal<
    Readonly<Record<string, Readonly<Record<string, PreviewValue>>>>
  >({});
  const [wildcardValues, setWildcardValues] = createSignal<
    Readonly<Record<string, Readonly<Record<string, t.Type>>>>
  >({});
  const [previewSelected, setPreviewSelected] = createSignal(false);
  const [measured, setMeasured] = createSignal<{
    readonly width: number;
    readonly height: number;
  }>();
  let previewElement: HTMLDivElement | undefined;

  const values = createMemo(() =>
    Object.fromEntries(
      props.schema.properties.map((property) => [
        property.id,
        propertyValues()[props.schema.id]?.[property.id] ?? propertyDefault(property),
      ]),
    ),
  );
  const wildcardIds = createMemo(() => {
    const ids = new Set<string>();
    for (const port of [...props.schema.dataInputs, ...props.schema.dataOutputs])
      collectWildcardIds(port.type, ids);
    for (const port of [...props.schema.executionInputs, ...props.schema.executionOutputs])
      for (const field of port.scope ?? []) collectWildcardIds(field.type, ids);
    return [...ids];
  });
  const previewIO = createMemo<NodeIO>(() => {
    const schema = props.schema;
    const functionProperty = schema.properties.find((property) => "function" in property);
    const functionId = functionProperty === undefined ? undefined : values()[functionProperty.id];
    const functionIO =
      typeof functionId === "string"
        ? GraphFunction.callIO(
            props.functions?.find((candidate) => candidate.canvas.id === functionId),
          )
        : undefined;
    const declared = functionIO === undefined ? schema : { ...schema, ...functionIO };
    const selectedValues = wildcardValues()[schema.id] ?? {};
    const preview =
      props.generateIO?.({
        schema,
        declared,
        properties: values(),
        resolve: (type) => resolveWildcards(type, selectedValues),
      }) ?? declared;
    const resolveDataPort = (port: Package.SchemaModel["dataInputs"][number]) => ({
      ...port,
      type: resolveWildcards(port.type, selectedValues),
    });
    const resolveExecutionPort = (port: Package.SchemaModel["executionInputs"][number]) => ({
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
  const previewNode = createMemo<Node.Model>(() => ({
    id: NodeId.make("module-reference-preview"),
    name: props.schema.name,
    properties: values(),
    inputDefaults: {},
    foldPins: false,
    schema: { package: props.package.id, schema: props.schema.id },
    position: { x: 0, y: 0 },
  }));
  const previewSize = createMemo(() => {
    const size = measured();
    if (size !== undefined) return size;
    const io = previewIO();
    return {
      width: graphNodeWidth(io, props.schema.name),
      height: graphNodeHeight(graphNodeInputs(io), graphNodeOutputs(io)),
    };
  });

  const copyPreview = (event: ClipboardEvent) => {
    if (!previewSelected() || event.clipboardData === null) return;
    const node = previewNode();
    const text = JSON.stringify({
      format: "macrograph/nodes",
      version: 1,
      nodes: [node],
      connections: [],
      externalConnections: [],
      nodeIO: { [node.id]: previewIO() },
      nodeSchemas: {
        [node.id]: { moduleName: props.package.name, schemaName: props.schema.name },
      },
    } satisfies Clipboard.Fragment);
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  };
  const setProperty = (propertyId: string, value: PreviewValue) =>
    setPropertyValues((current) => ({
      ...current,
      [props.schema.id]: { ...current[props.schema.id], [propertyId]: value },
    }));
  const clearProperty = (propertyId: string) =>
    setPropertyValues((current) => {
      const next = { ...current[props.schema.id] };
      delete next[propertyId];
      return { ...current, [props.schema.id]: next };
    });
  const setWildcard = (wildcardId: string, value: t.Type) =>
    setWildcardValues((current) => ({
      ...current,
      [props.schema.id]: { ...current[props.schema.id], [wildcardId]: value },
    }));

  return (
    <div sx={styles.content}>
      <header sx={styles.header}>
        <div sx={styles.titleRow}>
          <h2 sx={styles.title}>{props.schema.name}</h2>
          <span sx={[styles.typeBadge, schemaBackground(props.schema.type)]}>
            {props.schema.type}
          </span>
        </div>
        <p
          sx={[
            styles.description,
            props.schema.description === undefined ? styles.missingDescription : null,
          ]}
        >
          <Show when={props.schema.description} fallback="No description provided.">
            {(description) => <Description text={description()} />}
          </Show>
        </p>
      </header>
      <div sx={styles.configuration}>
        <div
          ref={previewElement}
          sx={styles.preview}
          style={{ height: `${previewSize().height}px`, width: `${previewSize().width}px` }}
          tabindex={-1}
          onCopy={copyPreview}
        >
          <GraphNode
            node={previewNode()}
            schema={props.schema}
            io={previewIO()}
            definitions={props.definitions}
            allowInputDefaults={false}
            onSizeChange={(_nodeId, size) => setMeasured(size)}
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
        </div>
        <Show when={wildcardIds().length > 0 || props.schema.properties.length > 0}>
          <div sx={styles.controls}>
            <Show when={wildcardIds().length > 0}>
              <section sx={styles.section}>
                <h3 sx={styles.sectionTitle}>Wildcards</h3>
                <div sx={styles.properties}>
                  <For each={wildcardIds()}>
                    {(wildcardId) => (
                      <label sx={styles.section}>
                        <span sx={styles.note}>{wildcardId}</span>
                        <DataTypePicker
                          label={`${wildcardId} wildcard type`}
                          value={wildcardValues()[props.schema.id]?.[wildcardId] ?? t.String}
                          definitions={props.definitions}
                          onChange={(value) => setWildcard(wildcardId, value)}
                        />
                      </label>
                    )}
                  </For>
                </div>
              </section>
            </Show>
            <Show when={props.schema.properties.length > 0}>
              <section sx={styles.section}>
                <h3 sx={styles.sectionTitle}>Properties</h3>
                <div sx={styles.properties}>
                  <For each={props.schema.properties}>
                    {(property) => (
                      <Show
                        when={"resource" in property ? undefined : property}
                        fallback={
                          <div>
                            <div sx={styles.propertyName}>{property.name}</div>
                            <p sx={styles.note}>
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
                            functions={props.functions ?? []}
                            value={values()[property.id]}
                            onSet={(value) => {
                              if (
                                value === null ||
                                typeof value === "string" ||
                                typeof value === "number" ||
                                typeof value === "boolean"
                              )
                                setProperty(property.id, value);
                            }}
                            onClear={() => clearProperty(property.id)}
                          />
                        )}
                      </Show>
                    )}
                  </For>
                </div>
              </section>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
