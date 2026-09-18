import {
  BuiltinAuthoring,
  type Canvas,
  type Function as GraphFunction,
  type SchemaAuthoring,
  TypeDefinition,
  type Node,
  type NodeIO,
  type Package,
  type Project,
  ResourceConstant,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { Select } from "../../ui/Select";
import { PropertyControl } from "./PropertyControl";
import { SchemaInfoButton } from "./SchemaInfoButton";
import { SourceProperty } from "./SourceProperty";

const styles = stylex.create({
  empty: {
    color: colors.gray11,
    flex: 1,
    fontSize: 12,
    fontStyle: "italic",
    height: "100%",
    padding: 16,
    textAlign: "center",
    width: "100%",
  },
  panel: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    overflowY: "auto",
    minHeight: 0,
  },
  title: { color: colors.gray12, fontSize: 12, fontWeight: 600 },
  field: { display: "flex", flexDirection: "column", gap: 2 },
  fieldLabel: { color: colors.gray11, fontSize: 11, fontWeight: 500 },
  value: { color: colors.gray12, fontSize: 12 },
  editable: {
    borderRadius: 2,
    color: colors.gray12,
    fontSize: 12,
    height: 24,
    marginInline: -4,
    outline: "none",
    paddingInline: 4,
    textAlign: "left",
    backgroundColor: {
      default: "transparent",
      ":hover": "color-mix(in srgb, var(--gray-12) 5%, transparent)",
    },
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  input: {
    backgroundColor: colors.gray2,
    boxShadow: {
      default: `0 0 0 1px ${colors.gray6}`,
      ":focus-visible": `inset 0 0 0 1px ${colors.focus}`,
    },
  },
  schema: { display: "flex", flexDirection: "column", marginTop: 4 },
  schemaLabel: { display: "block", marginBottom: 4 },
  properties: { display: "flex", flexDirection: "column", gap: 8, marginTop: 16 },
  warning: { color: colors.red11, fontSize: 11, overflowWrap: "anywhere" },
  signature: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  signatureHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  signatureList: { display: "flex", flexDirection: "column", gap: 6 },
  signatureRow: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 76px 24px", gap: 4 },
  fieldInput: {
    minWidth: 0,
    height: 24,
    borderRadius: 2,
    backgroundColor: colors.gray2,
    boxShadow: `0 0 0 1px ${colors.gray6}`,
    paddingInline: 4,
    fontSize: 11,
    color: colors.gray12,
    outline: "none",
  },
  fieldButton: {
    height: 24,
    borderRadius: 2,
    backgroundColor: { default: colors.gray3, ":hover": colors.gray4 },
    color: colors.gray11,
    fontSize: 12,
  },
});

const scalarTypes = [
  DataType.String,
  DataType.Int,
  DataType.Float,
  DataType.Bool,
  DataType.DateTime,
];

function SignatureFields(props: {
  title: string;
  direction: "input" | "output";
  fields: ReadonlyArray<GraphFunction.Field>;
  canEdit: boolean;
  onAdd: (direction: "input" | "output") => void;
  onUpdate: (direction: "input" | "output", field: GraphFunction.Field) => void;
  onDelete: (direction: "input" | "output", fieldId: string) => void;
}) {
  return (
    <div sx={styles.signature}>
      <div sx={styles.signatureHeader}>
        <span sx={styles.title}>{props.title}</span>
        <Show when={props.canEdit}>
          <button
            type="button"
            sx={styles.fieldButton}
            onClick={() => props.onAdd(props.direction)}
          >
            Add
          </button>
        </Show>
      </div>
      <div sx={styles.signatureList}>
        <For each={props.fields}>
          {(field) => (
            <div sx={styles.signatureRow}>
              <input
                sx={styles.fieldInput}
                value={field.name}
                disabled={!props.canEdit}
                onBlur={(event) =>
                  props.onUpdate(props.direction, { ...field, name: event.currentTarget.value })
                }
              />
              <select
                sx={styles.fieldInput}
                value={field.type._tag}
                disabled={!props.canEdit}
                onChange={(event) => {
                  const type = scalarTypes.find((type) => type._tag === event.currentTarget.value);
                  if (type !== undefined) props.onUpdate(props.direction, { ...field, type });
                }}
              >
                <For each={scalarTypes}>
                  {(type) => <option value={type._tag}>{type._tag}</option>}
                </For>
              </select>
              <Show when={props.canEdit}>
                <button
                  type="button"
                  aria-label={`Delete ${field.name}`}
                  title="Delete field"
                  sx={styles.fieldButton}
                  onClick={() => props.onDelete(props.direction, field.id)}
                >
                  ×
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export function Inspector(props: {
  graph: Canvas.Model | null;
  node: Node.Model | null;
  packages: ReadonlyArray<Package.Model>;
  authoring?: SchemaAuthoring.Registry;
  nodeDiagnostics?: Readonly<Record<string, ReadonlyArray<string>>>;
  constants: Project.Model["constants"];
  definitions?: DataType.Definitions;
  nodeIO?: Readonly<Record<string, NodeIO>>;
  onSaveDefault?: (nodeId: string, input: string, value: unknown) => Promise<unknown>;
  onRemoveDefault?: (nodeId: string, input: string) => Promise<unknown>;
  fn?: GraphFunction.Model | undefined;
  canEdit: boolean;
  editingGraphNameId: string | null;
  onEditingGraphNameChange: (id: string | null) => void;
  onRenameGraph: (name: string) => void;
  editingNodeNameId: string | null;
  onEditingNodeNameChange: (id: string | null) => void;
  onRenameNode: (name: string) => void;
  onSetNodeProperty: (property: string, value: unknown) => void;
  onClearNodeProperty: (property: string) => void;
  onAddFunctionField: (direction: "input" | "output") => void;
  onUpdateFunctionField: (direction: "input" | "output", field: GraphFunction.Field) => void;
  onDeleteFunctionField: (direction: "input" | "output", fieldId: string) => void;
}) {
  const schemaForNode = (node: Node.Model) =>
    props.packages
      .find((pkg) => pkg.id === node.schema.package)
      ?.schemas.find((schema) => schema.id === node.schema.schema);

  return (
    <Show
      when={props.node}
      fallback={
        <Show when={props.graph} fallback={<div sx={styles.empty}>No information available</div>}>
          {(graph) => (
            <div sx={styles.panel}>
              <span sx={styles.title}>Graph Info</span>
              <div sx={styles.field}>
                <span sx={styles.fieldLabel}>Name</span>
                <Show when={props.canEdit} fallback={<span sx={styles.value}>{graph().name}</span>}>
                  <Show
                    when={props.editingGraphNameId === graph().id}
                    fallback={
                      <button
                        type="button"
                        sx={styles.editable}
                        onClick={() => props.onEditingGraphNameChange(graph().id)}
                      >
                        {graph().name}
                      </button>
                    }
                  >
                    <input
                      ref={(input) =>
                        queueMicrotask(() => {
                          input.focus();
                          input.select();
                        })
                      }
                      sx={[styles.editable, styles.input]}
                      value={graph().name}
                      onBlur={(event) => {
                        props.onRenameGraph(event.currentTarget.value);
                        props.onEditingGraphNameChange(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          event.currentTarget.value = graph().name;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </Show>
                </Show>
              </div>
              <div sx={styles.field}>
                <span sx={styles.fieldLabel}>Total Nodes</span>
                <span sx={styles.value}>{Object.keys(graph().nodes).length}</span>
              </div>
              <Show when={props.fn}>
                {(fn) => (
                  <>
                    <SignatureFields
                      title="Inputs"
                      direction="input"
                      fields={fn().arguments}
                      canEdit={props.canEdit}
                      onAdd={props.onAddFunctionField}
                      onUpdate={props.onUpdateFunctionField}
                      onDelete={props.onDeleteFunctionField}
                    />
                    <SignatureFields
                      title="Outputs"
                      direction="output"
                      fields={fn().returns}
                      canEdit={props.canEdit}
                      onAdd={props.onAddFunctionField}
                      onUpdate={props.onUpdateFunctionField}
                      onDelete={props.onDeleteFunctionField}
                    />
                  </>
                )}
              </Show>
            </div>
          )}
        </Show>
      }
    >
      {(node) => {
        const schema = () => schemaForNode(node());
        const pkg = () =>
          props.packages.find((candidate) => candidate.id === node().schema.package);
        const io = () => props.nodeIO?.[node().id];
        const diagnostics = () => [
          ...new Set([
            ...(props.nodeDiagnostics?.[node().id] ?? []),
            ...TypeDefinition.nodeDiagnostics(
              node(),
              io() ?? {
                executionInputs: [],
                executionOutputs: [],
                dataInputs: [],
                dataOutputs: [],
              },
              props.definitions ?? {},
            ),
          ]),
        ];
        return (
          <div sx={styles.panel}>
            <span sx={styles.title}>Node Info</span>
            <Show when={!schema()}>
              <span sx={styles.warning}>
                Missing node schema. Restore its type or remove this node.
              </span>
            </Show>
            <For each={diagnostics()}>
              {(diagnostic) => <span sx={styles.warning}>{diagnostic}</span>}
            </For>
            <div sx={styles.field}>
              <span sx={styles.fieldLabel}>Name</span>
              <Show when={props.canEdit} fallback={<span sx={styles.value}>{node().name}</span>}>
                <Show
                  when={props.editingNodeNameId === node().id}
                  fallback={
                    <button
                      type="button"
                      sx={styles.editable}
                      onClick={() => props.onEditingNodeNameChange(node().id)}
                    >
                      {node().name}
                    </button>
                  }
                >
                  <input
                    ref={(input) =>
                      queueMicrotask(() => {
                        input.focus();
                        input.select();
                      })
                    }
                    sx={[styles.editable, styles.input]}
                    value={node().name}
                    onBlur={(event) => {
                      props.onRenameNode(event.currentTarget.value);
                      props.onEditingNodeNameChange(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        event.currentTarget.value = node().name;
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </Show>
              </Show>
            </div>
            <Show when={schema()}>
              {(schema) => (
                <div sx={styles.schema}>
                  <span sx={[styles.fieldLabel, styles.schemaLabel]}>Schema</span>
                  <SchemaInfoButton
                    schema={schema()}
                    packageName={pkg()?.name ?? "Unknown Module"}
                  />
                  <Show when={schema().properties.length > 0}>
                    <div sx={styles.properties}>
                      <span sx={styles.title}>Properties</span>
                      <For each={schema().properties}>
                        {(property) => (
                          <Show
                            when={"resource" in property ? property : undefined}
                            fallback={
                              <Show
                                when={
                                  (props.authoring ?? BuiltinAuthoring.registry).get(node().schema)
                                    ?.properties?.[property.id]
                                }
                                fallback={
                                  <PropertyControl
                                    property={
                                      property as Extract<
                                        Package.PropertyDefinition,
                                        { readonly type: unknown }
                                      >
                                    }
                                    value={node().properties[property.id]}
                                    onSet={(value) => props.onSetNodeProperty(property.id, value)}
                                    onClear={() => props.onClearNodeProperty(property.id)}
                                  />
                                }
                              >
                                {(source) => (
                                  <SourceProperty
                                    source={source()}
                                    property={property}
                                    properties={node().properties}
                                    definitions={props.definitions ?? {}}
                                    disabled={!props.canEdit}
                                    onChange={(value) =>
                                      props.onSetNodeProperty(property.id, value)
                                    }
                                    onClear={() => props.onClearNodeProperty(property.id)}
                                  />
                                )}
                              </Show>
                            }
                          >
                            {(resourceProperty) => {
                              const constants = () =>
                                Object.values(props.constants).filter(
                                  (constant) =>
                                    constant.resource.package === node().schema.package &&
                                    constant.resource.resource === resourceProperty().resource,
                                );
                              const selected = () => node().properties[property.id];
                              const defaultConstant = () =>
                                ResourceConstant.getDefault(props.constants, {
                                  package: node().schema.package,
                                  resource: resourceProperty().resource,
                                });
                              const selectedConstantId = () => {
                                const value = selected();
                                return typeof value === "string" ? value : "";
                              };
                              const valid = () =>
                                typeof selected() === "string" &&
                                constants().some((constant) => constant.id === selected());
                              return (
                                <label sx={styles.field}>
                                  <span sx={styles.fieldLabel}>{property.name}</span>
                                  <Select
                                    options={constants().map((constant) => ({
                                      id: constant.id,
                                      name:
                                        constant.id === defaultConstant()?.id
                                          ? `Default (${constant.name})`
                                          : constant.name,
                                    }))}
                                    value={selectedConstantId()}
                                    valid={valid()}
                                    placeholder="Missing constant"
                                    onChange={(value) =>
                                      props.onSetNodeProperty(property.id, value)
                                    }
                                  />
                                </label>
                              );
                            }}
                          </Show>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
