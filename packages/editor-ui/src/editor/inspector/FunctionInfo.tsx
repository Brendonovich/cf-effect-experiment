import type { Graph } from "@macrograph/core";

import { DataType } from "@macrograph/plugin/DataType";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { DataTypePicker } from "../../ui/DataTypePicker";

const styles = stylex.create({
  panel: { alignItems: "stretch", display: "flex", flexDirection: "column", gap: 6, padding: 8 },
  title: { color: colors.gray12, fontSize: 12, fontWeight: 600 },
  value: { color: colors.gray12, fontSize: 12 },
  field: { display: "flex", flexDirection: "column", gap: 2 },
  fieldLabel: { color: colors.gray11, fontSize: 11, fontWeight: 500 },
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
  section: { display: "flex", flexDirection: "column", gap: 6, marginTop: 6 },
  sectionHeader: { alignItems: "center", display: "flex", minHeight: 24 },
  sectionTitle: { flex: 1 },
  iconButton: {
    alignItems: "center",
    backgroundColor: { default: "transparent", ":hover": colors.gray5 },
    borderRadius: 3,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    display: "flex",
    flexShrink: 0,
    height: 22,
    justifyContent: "center",
    outline: "none",
    width: 22,
    ":focus-visible": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
  },
  smallIcon: { height: 14, width: 14 },
  fieldList: { display: "flex", flexDirection: "column", gap: 4 },
  functionField: {
    alignItems: "center",
    backgroundColor: colors.gray2,
    borderColor: colors.gray5,
    borderRadius: 4,
    borderStyle: "solid",
    borderWidth: 1,
    display: "grid",
    gap: 4,
    gridTemplateColumns: "22px minmax(0, 1fr) 22px",
    padding: 4,
  },
  draggingField: { opacity: 0.45 },
  dragHandle: { cursor: "grab", ":active": { cursor: "grabbing" } },
  dragIcon: { height: 16, rotate: "90deg", width: 16 },
  fieldName: {
    borderRadius: 2,
    fontSize: 12,
    fontWeight: 500,
    height: 22,
    minWidth: 0,
    outline: "none",
    overflow: "hidden",
    paddingInline: 4,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    ":focus-visible": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
  },
  fieldNameInput: {
    backgroundColor: colors.gray1,
    boxShadow: `inset 0 0 0 1px ${colors.focus}`,
  },
  typePicker: { gridColumn: "2 / 4", minWidth: 0 },
});

type FieldLocation = { readonly side: "inputs" | "outputs"; readonly id: string };

export function FunctionInfo(props: {
  graph: Graph.Model;
  canEdit: boolean;
  editingName: boolean;
  error: string | null | undefined;
  onEditingNameChange: (editing: boolean) => void;
  onRename: (name: string) => void;
  onSetSignature: ((signature: Graph.FunctionSignature) => void) | undefined;
}) {
  const [editingField, setEditingField] = createSignal<FieldLocation | null>(null);
  const [draggedField, setDraggedField] = createSignal<FieldLocation | null>(null);
  const signature = () => props.graph.signature ?? { inputs: [], outputs: [] };

  return (
    <div sx={styles.panel}>
      <span sx={styles.title}>Function Info</span>
      <Show when={props.error}>
        <div role="alert" sx={styles.value}>
          {props.error}
        </div>
      </Show>
      <div sx={styles.field}>
        <span sx={styles.fieldLabel}>Name</span>
        <Show when={props.canEdit} fallback={<span sx={styles.value}>{props.graph.name}</span>}>
          <Show
            when={props.editingName}
            fallback={
              <button
                type="button"
                sx={styles.editable}
                onClick={() => props.onEditingNameChange(true)}
              >
                {props.graph.name}
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
              value={props.graph.name}
              onBlur={(event) => {
                props.onRename(event.currentTarget.value);
                props.onEditingNameChange(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.currentTarget.value = props.graph.name;
                  event.currentTarget.blur();
                }
              }}
            />
          </Show>
        </Show>
      </div>
      <For each={["inputs", "outputs"] as const}>
        {(side) => {
          const fields = () => signature()[side];
          const update = (next: ReadonlyArray<Graph.FunctionField>) =>
            props.onSetSignature?.({ ...signature(), [side]: next });
          const add = () => {
            const field = {
              id: crypto.randomUUID(),
              name:
                side === "inputs"
                  ? `Argument ${fields().length + 1}`
                  : `Result ${fields().length + 1}`,
              type: DataType.String,
            };
            setEditingField({ side, id: field.id });
            update([...fields(), field]);
          };
          return (
            <section sx={styles.section}>
              <div sx={styles.sectionHeader}>
                <span sx={[styles.title, styles.sectionTitle]}>
                  {side === "inputs" ? "Arguments" : "Results"}
                </span>
                <Show when={props.canEdit}>
                  <button
                    type="button"
                    sx={styles.iconButton}
                    aria-label={`Add ${side === "inputs" ? "argument" : "result"}`}
                    title={`Add ${side === "inputs" ? "argument" : "result"}`}
                    onClick={add}
                  >
                    <IconBiPlus aria-hidden="true" {...stylex.attrs(styles.smallIcon)} />
                  </button>
                </Show>
              </div>
              <div sx={styles.fieldList}>
                <For each={fields()}>
                  {(field) => {
                    const editing = () =>
                      editingField()?.side === side && editingField()?.id === field.id;
                    const dragging = () =>
                      draggedField()?.side === side && draggedField()?.id === field.id;
                    return (
                      <div
                        sx={[styles.functionField, dragging() ? styles.draggingField : null]}
                        onDragOver={(event) => {
                          if (draggedField()?.side === side) event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const dragged = draggedField();
                          setDraggedField(null);
                          if (dragged?.side !== side || dragged.id === field.id || !props.canEdit)
                            return;
                          const next = [...fields()];
                          const from = next.findIndex((item) => item.id === dragged.id);
                          const to = next.findIndex((item) => item.id === field.id);
                          if (from < 0 || to < 0) return;
                          const [moved] = next.splice(from, 1);
                          if (moved === undefined) return;
                          next.splice(to, 0, moved);
                          update(next);
                        }}
                      >
                        <button
                          type="button"
                          draggable={props.canEdit ? "true" : "false"}
                          disabled={!props.canEdit}
                          sx={[styles.iconButton, styles.dragHandle]}
                          aria-label={`Drag ${field.name} to reorder`}
                          title="Drag to reorder"
                          onDragStart={(event) => {
                            if (!props.canEdit) {
                              event.preventDefault();
                              return;
                            }
                            event.dataTransfer?.setData(
                              "application/x-macrograph-function-field",
                              field.id,
                            );
                            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                            setDraggedField({ side, id: field.id });
                          }}
                          onDragEnd={() => setDraggedField(null)}
                        >
                          <IconMdiDotsHorizontal
                            aria-hidden="true"
                            {...stylex.attrs(styles.dragIcon)}
                          />
                        </button>
                        <Show
                          when={editing()}
                          fallback={
                            <button
                              type="button"
                              sx={styles.fieldName}
                              disabled={!props.canEdit}
                              onClick={() => setEditingField({ side, id: field.id })}
                            >
                              {field.name}
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
                            aria-label={`${side} field name`}
                            sx={[styles.fieldName, styles.fieldNameInput]}
                            value={field.name}
                            onBlur={(event) => {
                              const name = event.currentTarget.value.trim();
                              update(
                                fields().map((item) =>
                                  item.id === field.id
                                    ? { ...item, name: name === "" ? field.name : name }
                                    : item,
                                ),
                              );
                              setEditingField(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                              if (event.key === "Escape") {
                                event.currentTarget.value = field.name;
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </Show>
                        <button
                          type="button"
                          sx={styles.iconButton}
                          disabled={!props.canEdit}
                          aria-label={`Remove ${field.name}`}
                          title="Remove"
                          onClick={() => update(fields().filter((item) => item.id !== field.id))}
                        >
                          <IconTablerTrash aria-hidden="true" {...stylex.attrs(styles.smallIcon)} />
                        </button>
                        <div sx={styles.typePicker}>
                          <DataTypePicker
                            value={field.type}
                            disabled={!props.canEdit}
                            label={`${field.name} type`}
                            onChange={(type) =>
                              update(
                                fields().map((item) =>
                                  item.id === field.id ? { ...item, type } : item,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </section>
          );
        }}
      </For>
    </div>
  );
}
