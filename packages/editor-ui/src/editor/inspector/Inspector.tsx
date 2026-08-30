import type { Graph, Node, Package, Project } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { PropertyControl } from "./PropertyControl";
import { SchemaInfoButton } from "./SchemaInfoButton";
import { Select } from "../../ui/Select";

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
            </div>
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
                                    { readonly type: unknown }
                                  >
                                }
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
                              const options = () =>
                                resourceProperty().optional
                                  ? [{ id: "", name: "All" }, ...constants()]
                                  : constants();
                              const valid = () => {
                                if (resourceProperty().optional && selectedConstantId() === "")
                                  return true;
                                return (
                                  typeof selected() === "string" &&
                                  constants().some((constant) => constant.id === selected())
                                );
                              };
                              return (
                                <label sx={styles.field}>
                                  <span sx={styles.fieldLabel}>{property.name}</span>
                                  <Select
                                    options={options()}
                                    value={selectedConstantId()}
                                    valid={valid()}
                                    placeholder={
                                      resourceProperty().optional ? "All" : "Missing constant"
                                    }
                                    onChange={(value) => {
                                      if (value === "")
                                        props.onClearNodeProperty(property.id);
                                      else props.onSetNodeProperty(property.id, value);
                                    }}
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
