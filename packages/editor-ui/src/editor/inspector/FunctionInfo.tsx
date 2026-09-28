import type { Canvas, Function as GraphFunction } from "@macrograph/core";
import type { DataType } from "@macrograph/module/DataType";

import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { DataTypePicker } from "../../ui/DataTypePicker";
import { functionFieldMarker } from "../markers.stylex.ts";

const styles = stylex.create({
  panel: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 0,
    overflowY: "auto",
    padding: 8,
  },
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
    backgroundColor: "transparent",
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
    "@media (hover: hover)": {
      ":hover": { backgroundColor: "color-mix(in srgb, var(--gray-12) 5%, transparent)" },
    },
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
    backgroundColor: "transparent",
    borderRadius: 3,
    color: colors.gray10,
    display: "flex",
    flexShrink: 0,
    height: 22,
    justifyContent: "center",
    outline: "none",
    width: 22,
    ":focus-visible": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
    "@media (hover: hover)": { ":hover": { backgroundColor: colors.gray5, color: colors.gray12 } },
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
    gridTemplateColumns: "14px minmax(0, 1fr) 22px",
    padding: 4,
  },
  draggingField: { opacity: 0.45 },
  dragHandle: {
    alignItems: "center",
    alignSelf: "center",
    cursor: "grab",
    display: "flex",
    gridRow: "1 / 3",
    justifyContent: "center",
    ":active": { cursor: "grabbing" },
  },
  dragIcon: { height: 14, rotate: "90deg", width: 14 },
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
    backgroundColor: "transparent",
    ":focus-visible": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
    "@media (hover: hover)": { ":hover": { backgroundColor: colors.gray4 } },
  },
  fieldNameInput: {
    backgroundColor: colors.gray1,
    boxShadow: `inset 0 0 0 1px ${colors.focus}`,
  },
  typePicker: { gridColumn: "2 / 4", minWidth: 0 },
  deleteButton: {
    visibility: { default: "hidden", ":focus": "visible" },
    "@media (hover: hover)": {
      [stylex.when.ancestor(":hover", functionFieldMarker)]: { visibility: "visible" },
    },
  },
});

type FieldLocation = { readonly direction: "input" | "output"; readonly id: string };

export function FunctionInfo(props: {
  graph: Canvas.Model;
  fn: GraphFunction.Model;
  definitions: DataType.Definitions;
  canEdit: boolean;
  editingName: boolean;
  onEditingNameChange: (editing: boolean) => void;
  onRename: (name: string) => void;
  onAddField: (direction: "input" | "output") => Promise<string | undefined>;
  onUpdateField: (direction: "input" | "output", field: GraphFunction.Field) => void;
  onReorderField: (direction: "input" | "output", fieldId: string, targetFieldId: string) => void;
  onDeleteField: (direction: "input" | "output", fieldId: string) => void;
}) {
  const [editingField, setEditingField] = createSignal<FieldLocation | null>(null);
  const [draggedField, setDraggedField] = createSignal<FieldLocation | null>(null);

  return (
    <div sx={styles.panel}>
      <span sx={styles.title}>Function</span>
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
      <For each={["input", "output"] as const}>
        {(direction) => {
          const fields = () => (direction === "input" ? props.fn.arguments : props.fn.returns);
          return (
            <section sx={styles.section}>
              <div sx={styles.sectionHeader}>
                <span sx={[styles.title, styles.sectionTitle]}>
                  {direction === "input" ? "Arguments" : "Results"}
                </span>
                <Show when={props.canEdit}>
                  <button
                    type="button"
                    sx={styles.iconButton}
                    aria-label={`Add ${direction === "input" ? "argument" : "result"}`}
                    title={`Add ${direction === "input" ? "argument" : "result"}`}
                    onClick={() =>
                      void props.onAddField(direction).then((id) => {
                        if (id !== undefined) setEditingField({ direction, id });
                      })
                    }
                  >
                    <IconBiPlus aria-hidden="true" {...stylex.attrs(styles.smallIcon)} />
                  </button>
                </Show>
              </div>
              <div sx={styles.fieldList}>
                <For each={fields()}>
                  {(field) => {
                    const editing = () =>
                      editingField()?.direction === direction && editingField()?.id === field.id;
                    const dragging = () =>
                      draggedField()?.direction === direction && draggedField()?.id === field.id;
                    return (
                      <div
                        sx={[
                          functionFieldMarker,
                          styles.functionField,
                          dragging() ? styles.draggingField : null,
                        ]}
                        onDragOver={(event) => {
                          if (draggedField()?.direction === direction) event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const dragged = draggedField();
                          setDraggedField(null);
                          if (
                            dragged?.direction !== direction ||
                            dragged.id === field.id ||
                            !props.canEdit
                          )
                            return;
                          props.onReorderField(direction, dragged.id, field.id);
                        }}
                      >
                        <div
                          draggable={props.canEdit ? "true" : "false"}
                          sx={styles.dragHandle}
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
                            setDraggedField({ direction, id: field.id });
                          }}
                          onDragEnd={() => setDraggedField(null)}
                        >
                          <IconMdiDotsHorizontal
                            aria-hidden="true"
                            {...stylex.attrs(styles.dragIcon)}
                          />
                        </div>
                        <Show
                          when={editing()}
                          fallback={
                            <button
                              type="button"
                              sx={styles.fieldName}
                              disabled={!props.canEdit}
                              onClick={() => setEditingField({ direction, id: field.id })}
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
                            aria-label={`${direction} field name`}
                            sx={[styles.fieldName, styles.fieldNameInput]}
                            value={field.name}
                            onBlur={(event) => {
                              const name = event.currentTarget.value.trim();
                              props.onUpdateField(direction, {
                                ...field,
                                name: name === "" ? field.name : name,
                              });
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
                          sx={[styles.iconButton, styles.deleteButton]}
                          disabled={!props.canEdit}
                          aria-label={`Remove ${field.name}`}
                          title="Remove"
                          onClick={() => props.onDeleteField(direction, field.id)}
                        >
                          <IconTablerTrash aria-hidden="true" {...stylex.attrs(styles.smallIcon)} />
                        </button>
                        <div sx={styles.typePicker}>
                          <DataTypePicker
                            value={field.type}
                            definitions={props.definitions}
                            disabled={!props.canEdit}
                            label={`${field.name} type`}
                            onChange={(type) => props.onUpdateField(direction, { ...field, type })}
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
