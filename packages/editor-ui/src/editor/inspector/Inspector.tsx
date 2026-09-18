import type { Graph, Node, Package, Project } from "@macrograph/core";

import { FunctionGraph } from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { Select } from "../../ui/Select";
import { FunctionInfo } from "./FunctionInfo";
import { PropertyControl } from "./PropertyControl";
import { SchemaInfoButton } from "./SchemaInfoButton";

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
  panel: { alignItems: "stretch", display: "flex", flexDirection: "column", gap: 6, padding: 8 },
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
});

export function Inspector(props: {
  graph: Graph.Model | null;
  functions?: ReadonlyArray<Graph.Model>;
  onSetFunctionSignature?: (signature: Graph.FunctionSignature) => void;
  functionError?: string | null;
  nodeIO?: Readonly<Record<string, import("@macrograph/core").NodeIO>>;
  node: Node.Model | null;
  packages: ReadonlyArray<Package.Model>;
  constants: Project.Model["constants"];
  canEdit: boolean;
  editingGraphNameId: string | null;
  onEditingGraphNameChange: (id: string | null) => void;
  onRenameGraph: (name: string) => void;
  editingNodeNameId: string | null;
  onEditingNodeNameChange: (id: string | null) => void;
  onRenameNode: (name: string) => void;
  onSetNodeProperty: (property: string, value: unknown) => void;
  onClearNodeProperty: (property: string) => void;
  onClearInputDefault?: (nodeId: string, input: string) => void;
  onDisconnectIo?: (direction: "input" | "output", nodeId: string, ioId: string) => void;
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
            <Show
              when={graph().kind === "function"}
              fallback={
                <div sx={styles.panel}>
                  <span sx={styles.title}>Graph Info</span>
                  <Show when={props.functionError}>
                    <div role="alert" sx={styles.value}>
                      {props.functionError}
                    </div>
                  </Show>
                  <div sx={styles.field}>
                    <span sx={styles.fieldLabel}>Name</span>
                    <Show
                      when={props.canEdit}
                      fallback={<span sx={styles.value}>{graph().name}</span>}
                    >
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
                </div>
              }
            >
              <FunctionInfo
                graph={graph()}
                canEdit={props.canEdit}
                editingName={props.editingGraphNameId === graph().id}
                error={props.functionError}
                onEditingNameChange={(editing) =>
                  props.onEditingGraphNameChange(editing ? graph().id : null)
                }
                onRename={props.onRenameGraph}
                onSetSignature={props.onSetFunctionSignature}
              />
            </Show>
          )}
        </Show>
      }
    >
      {(node) => {
        const schema = () => schemaForNode(node());
        const pkg = () =>
          props.packages.find((candidate) => candidate.id === node().schema.package);
        return (
          <div sx={styles.panel}>
            <span sx={styles.title}>Node Info</span>
            <Show when={props.functionError}>
              <div role="alert" sx={styles.value}>
                {props.functionError}
              </div>
            </Show>
            <Show when={FunctionGraph.isBoundary(node())}>
              <span sx={styles.fieldLabel}>
                System-owned function boundary. Cannot be copied, pasted, cut, or deleted.
              </span>
            </Show>
            <Show when={FunctionGraph.isCall(node())}>
              <For
                each={Object.keys(node().inputDefaults).filter((id) => {
                  const target = (props.functions ?? []).find(
                    (graph) => graph.id === node().properties.function,
                  );
                  const port = FunctionGraph.io("call", target?.signature).dataInputs.find(
                    (port) => port.id === id,
                  );
                  return (
                    port === undefined || !DataType.isValue(port.type, node().inputDefaults[id])
                  );
                })}
              >
                {(id) => (
                  <div role="alert" sx={styles.field}>
                    <span sx={styles.value}>Preserved incompatible default: {id}</span>
                    <button
                      type="button"
                      sx={styles.editable}
                      disabled={!props.canEdit}
                      onClick={() => props.onClearInputDefault?.(node().id, id)}
                    >
                      Clear preserved default
                    </button>
                  </div>
                )}
              </For>
              <For
                each={(props.graph?.connections ?? []).filter((connection) => {
                  if (connection.inNodeId !== node().id && connection.outNodeId !== node().id)
                    return false;
                  const target = (props.functions ?? []).find(
                    (graph) => graph.id === node().properties.function,
                  );
                  const io = FunctionGraph.io("call", target?.signature);
                  const input = connection.inNodeId === node().id;
                  const port = (
                    input
                      ? [...io.dataInputs, ...io.executionInputs]
                      : [...io.dataOutputs, ...io.executionOutputs]
                  ).find((port) => port.id === (input ? connection.inIoId : connection.outIoId));
                  if (port === undefined) return true;
                  const otherIO =
                    props.nodeIO?.[input ? connection.outNodeId : connection.inNodeId];
                  const other = (input ? otherIO?.dataOutputs : otherIO?.dataInputs)?.find(
                    (other) => other.id === (input ? connection.outIoId : connection.inIoId),
                  );
                  const dataPort = (input ? io.dataInputs : io.dataOutputs).find(
                    (port) => port.id === (input ? connection.inIoId : connection.outIoId),
                  );
                  return (
                    dataPort !== undefined &&
                    other !== undefined &&
                    !DataType.equals(dataPort.type, other.type)
                  );
                })}
              >
                {(connection) => (
                  <div role="alert" sx={styles.field}>
                    <span sx={styles.value}>
                      Preserved incompatible connection:{" "}
                      {connection.inNodeId === node().id ? connection.inIoId : connection.outIoId}
                    </span>
                    <button
                      type="button"
                      sx={styles.editable}
                      disabled={!props.canEdit}
                      onClick={() =>
                        props.onDisconnectIo?.(
                          connection.inNodeId === node().id ? "input" : "output",
                          node().id,
                          connection.inNodeId === node().id
                            ? connection.inIoId
                            : connection.outIoId,
                        )
                      }
                    >
                      Disconnect preserved connection
                    </button>
                  </div>
                )}
              </For>
            </Show>
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
                    packageName={pkg()?.name ?? "Unknown Plugin"}
                  />
                  <Show when={schema().properties.length > 0}>
                    <div sx={styles.properties}>
                      <span sx={styles.title}>Properties</span>
                      <For each={schema().properties}>
                        {(property) => (
                          <Show
                            when={"resource" in property ? property : undefined}
                            fallback={
                              <PropertyControl
                                property={
                                  property as Extract<
                                    Package.PropertyDefinition,
                                    { readonly type: unknown } | { readonly function: true }
                                  >
                                }
                                {...(props.functions === undefined
                                  ? {}
                                  : { functions: props.functions })}
                                value={node().properties[property.id]}
                                onSet={(value) => props.onSetNodeProperty(property.id, value)}
                                onClear={() => props.onClearNodeProperty(property.id)}
                              />
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
                                    options={constants()}
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
