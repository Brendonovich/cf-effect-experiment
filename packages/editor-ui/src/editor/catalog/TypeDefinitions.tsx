import { TypeDefinition, type Project } from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { Button } from "../../ui/Button";
import { DataTypePicker } from "../../ui/DataTypePicker";

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    minWidth: 0,
  },
  kindTabs: {
    alignItems: "center",
    backgroundColor: colors.gray3,
    borderBottom: `1px solid ${colors.gray5}`,
    display: "flex",
    height: 32,
    paddingInline: 4,
  },
  kindTab: {
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    borderRadius: 2,
    color: colors.gray10,
    flex: 1,
    fontSize: 11,
    fontWeight: 500,
    height: 24,
  },
  activeKind: { backgroundColor: colors.gray5, color: colors.gray12 },
  iconButton: {
    alignItems: "center",
    backgroundColor: { default: "transparent", ":hover": colors.gray5 },
    borderRadius: 2,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    display: "flex",
    flexShrink: 0,
    height: 24,
    justifyContent: "center",
    marginLeft: 4,
    outline: "none",
    width: 24,
    ":focus-visible": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
  },
  icon: { height: 15, width: 15 },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 8,
    borderBottom: `1px solid ${colors.gray6}`,
    minWidth: 0,
  },
  editorHeader: { alignItems: "center", display: "flex", gap: 4 },
  editorTitle: { color: colors.gray11, fontSize: 10, fontWeight: 600, textTransform: "uppercase" },
  row: { display: "flex", gap: 4, alignItems: "center" },
  input: {
    minWidth: 0,
    width: "100%",
    height: 24,
    paddingInline: 6,
    backgroundColor: colors.gray2,
    color: colors.gray12,
    border: 0,
    borderRadius: 2,
    boxShadow: `0 0 0 1px ${colors.gray6}`,
    outline: "none",
    ":focus": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
  },
  nameInput: { fontSize: 12, fontWeight: 500 },
  muted: { color: colors.gray9, fontSize: 11, overflowWrap: "anywhere" },
  warning: {
    color: colors.red11,
    backgroundColor: colors.red2,
    padding: 6,
    borderRadius: 2,
    overflowWrap: "anywhere",
  },
  notice: {
    backgroundColor: colors.gray3,
    borderLeft: `2px solid ${colors.focus}`,
    color: colors.gray11,
    padding: 6,
  },
  alert: { margin: 8 },
  fields: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.gray1,
    borderRadius: 3,
    paddingInline: 6,
  },
  member: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    paddingBlock: 6,
    borderBottom: `1px solid ${colors.gray5}`,
  },
  addMember: { alignSelf: "flex-start", marginBlock: 4 },
  typeList: { display: "flex", flexDirection: "column" },
  typeItem: {
    borderBottom: `1px solid ${colors.gray5}`,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBlock: 7,
    paddingInline: 8,
  },
  typeName: {
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    borderRadius: 2,
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    minWidth: 0,
    overflow: "hidden",
    padding: 4,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    color: colors.gray9,
    fontSize: 12,
    fontStyle: "italic",
    padding: 12,
    textAlign: "center",
  },
  dialog: {
    backgroundColor: colors.gray2,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 4,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 8,
    padding: 8,
  },
});

type Field = typeof DataType.Field.Type;
function Fields(props: {
  fields: readonly Field[];
  definitions: DataType.Definitions;
  disabled: boolean;
  onChange: (fields: readonly Field[]) => void;
}) {
  const update = (index: number, field: Field) =>
    props.onChange(props.fields.map((item, i) => (i === index ? field : item)));
  return (
    <div sx={styles.fields}>
      <For each={props.fields.map((_, index) => index)}>
        {(index) => (
          <div sx={styles.member} data-type-field={index}>
            <div sx={styles.row}>
              <input
                sx={styles.input}
                aria-label={`Field ${index + 1} name`}
                placeholder="Field name"
                value={props.fields[index]?.name ?? ""}
                disabled={props.disabled}
                onInput={(event) => {
                  const field = props.fields[index];
                  if (field) update(index, { ...field, name: event.currentTarget.value });
                }}
              />
              <button
                type="button"
                sx={styles.iconButton}
                aria-label={`Remove field ${index + 1}`}
                title="Remove field"
                disabled={props.disabled}
                onClick={() => props.onChange(props.fields.filter((_, i) => i !== index))}
              >
                <IconTablerTrash {...stylex.attrs(styles.icon)} />
              </button>
            </div>
            <DataTypePicker
              value={props.fields[index]?.type ?? DataType.String}
              definitions={props.definitions}
              disabled={props.disabled}
              label={`Field ${index + 1} type`}
              onChange={(type) => {
                const field = props.fields[index];
                if (field) update(index, { ...field, type });
              }}
            />
          </div>
        )}
      </For>
      <Button
        type="button"
        size="sm"
        variant="text"
        sx={styles.addMember}
        disabled={props.disabled}
        onClick={() => props.onChange([...props.fields, { name: "", type: DataType.String }])}
      >
        <IconBiPlus {...stylex.attrs(styles.icon)} /> Add field
      </Button>
    </div>
  );
}

export function TypeDefinitions(props: {
  project: Pick<Project.Model, "types" | "graphs"> | null;
  search: string;
  canEdit: boolean;
  onPreview: (change: TypeDefinition.Change) => Promise<TypeDefinition.Impact>;
  onConfirm: (token: string) => Promise<unknown>;
}) {
  const [kind, setKind] = createSignal<"Struct" | "Enum">("Struct");
  const [draft, setDraft] = createSignal<DataType.Definition | null>(null);
  const [impact, setImpact] = createSignal<TypeDefinition.Impact | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const definitions = createMemo(() => props.project?.types ?? {});
  const choices = createMemo(() => {
    const value = draft();
    return value ? { ...definitions(), [value.id]: value } : definitions();
  });
  const diagnostics = createMemo(() => TypeDefinition.validate(definitions()));
  const disabled = () => busy() || impact() !== null || !props.canEdit;
  const preview = async (change: TypeDefinition.Change) => {
    if (busy() || !props.canEdit) return;
    setBusy(true);
    setError("");
    try {
      setImpact(await props.onPreview(change));
    } catch {
      setError("Could not review this change. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    const pending = impact();
    if (!pending || busy() || !props.canEdit) return;
    setBusy(true);
    setError("");
    try {
      await props.onConfirm(pending.token);
      setImpact(null);
      setDraft(null);
    } catch {
      setError("The project changed before this edit was saved. Review the change again.");
      setImpact(null);
    } finally {
      setBusy(false);
    }
  };
  const create = (kind: "Struct" | "Enum") => {
    setError("");
    setImpact(null);
    const base = { id: DataType.DefinitionId.make(crypto.randomUUID()), name: "" };
    setDraft(
      kind === "Struct"
        ? { ...base, _tag: "Struct", fields: [] }
        : { ...base, _tag: "Enum", variants: [{ name: "", fields: [] }] },
    );
  };
  const filteredDefinitions = createMemo(() => {
    const query = props.search.trim().toLowerCase();
    return Object.values(definitions()).filter(
      (definition) => definition._tag === kind() && definition.name.toLowerCase().includes(query),
    );
  });
  return (
    <section
      sx={styles.panel}
      aria-label="Project types"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div sx={styles.kindTabs}>
        <button
          type="button"
          sx={[styles.kindTab, kind() === "Struct" ? styles.activeKind : null]}
          aria-pressed={kind() === "Struct" ? "true" : "false"}
          onClick={() => setKind("Struct")}
        >
          Structs
        </button>
        <button
          type="button"
          sx={[styles.kindTab, kind() === "Enum" ? styles.activeKind : null]}
          aria-pressed={kind() === "Enum" ? "true" : "false"}
          onClick={() => setKind("Enum")}
        >
          Enums
        </button>
        <button
          type="button"
          sx={styles.iconButton}
          aria-label={`New ${kind() === "Struct" ? "struct" : "enum"}`}
          title={`New ${kind() === "Struct" ? "struct" : "enum"}`}
          disabled={disabled()}
          onClick={() => create(kind())}
        >
          <IconBiPlus {...stylex.attrs(styles.icon)} />
        </button>
      </div>
      <Show when={error()}>
        <div role="alert" sx={[styles.warning, styles.alert]}>
          {error()}
        </div>
      </Show>
      <Show when={draft()}>
        {(value) => (
          <div sx={styles.editor} aria-label="Type authoring">
            <span sx={styles.editorTitle}>
              {definitions()[value().id] ? "Edit" : "Create"}{" "}
              {value()._tag === "Struct" ? "struct" : "tagged enum"}
            </span>
            <div sx={styles.editorHeader}>
              <input
                sx={[styles.input, styles.nameInput]}
                aria-label="Type name"
                placeholder="Type name"
                value={value().name}
                disabled={disabled()}
                onInput={(event) => setDraft({ ...value(), name: event.currentTarget.value })}
              />
              <button
                type="button"
                sx={styles.iconButton}
                aria-label="Cancel editing"
                title="Cancel editing"
                disabled={busy()}
                onClick={() => {
                  setDraft(null);
                  setImpact(null);
                  setError("");
                }}
              >
                <IconBiX {...stylex.attrs(styles.icon)} />
              </button>
            </div>
            <Show
              when={
                value()._tag === "Struct"
                  ? (value() as Extract<DataType.Definition, { _tag: "Struct" }>)
                  : undefined
              }
            >
              {(struct) => (
                <Fields
                  fields={struct().fields}
                  definitions={choices()}
                  disabled={disabled()}
                  onChange={(fields) => setDraft({ ...struct(), fields })}
                />
              )}
            </Show>
            <Show
              when={
                value()._tag === "Enum"
                  ? (value() as Extract<DataType.Definition, { _tag: "Enum" }>)
                  : undefined
              }
            >
              {(enumeration) => (
                <>
                  <For each={enumeration().variants.map((_, index) => index)}>
                    {(index) => (
                      <div sx={styles.fields} data-type-variant={index}>
                        <div sx={styles.member}>
                          <div sx={styles.row}>
                            <input
                              sx={styles.input}
                              aria-label={`Variant ${index + 1} name`}
                              placeholder="Variant name"
                              value={enumeration().variants[index]?.name ?? ""}
                              disabled={disabled()}
                              onInput={(event) =>
                                setDraft({
                                  ...enumeration(),
                                  variants: enumeration().variants.map((variant, i) =>
                                    i === index
                                      ? { ...variant, name: event.currentTarget.value }
                                      : variant,
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              sx={styles.iconButton}
                              aria-label={`Remove variant ${index + 1}`}
                              title="Remove variant"
                              disabled={disabled()}
                              onClick={() =>
                                setDraft({
                                  ...enumeration(),
                                  variants: enumeration().variants.filter((_, i) => i !== index),
                                })
                              }
                            >
                              <IconTablerTrash {...stylex.attrs(styles.icon)} />
                            </button>
                          </div>
                          <Fields
                            fields={enumeration().variants[index]?.fields ?? []}
                            definitions={choices()}
                            disabled={disabled()}
                            onChange={(fields) =>
                              setDraft({
                                ...enumeration(),
                                variants: enumeration().variants.map((variant, i) =>
                                  i === index ? { ...variant, fields } : variant,
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </For>
                  <Button
                    type="button"
                    size="sm"
                    variant="text"
                    sx={styles.addMember}
                    disabled={disabled()}
                    onClick={() =>
                      setDraft({
                        ...enumeration(),
                        variants: [...enumeration().variants, { name: "", fields: [] }],
                      })
                    }
                  >
                    <IconBiPlus {...stylex.attrs(styles.icon)} /> Add variant
                  </Button>
                </>
              )}
            </Show>
            <div sx={styles.row}>
              <Button
                type="button"
                size="sm"
                disabled={disabled()}
                onClick={() => void preview({ _tag: "Upsert", definition: value() })}
              >
                Review changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy()}
                onClick={() => {
                  setDraft(null);
                  setImpact(null);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={impact()}>
        {(pending) => (
          <div role="dialog" aria-label="Confirm type changes" sx={styles.dialog}>
            <strong>
              {pending().change._tag === "Delete" ? "Delete type?" : "Confirm type changes?"}
            </strong>
            <p sx={styles.notice}>
              Existing nodes, wires, and defaults are preserved. Incompatible values or missing pins
              remain invalid until you explicitly repair or remove them.
            </p>
            <Show when={pending().affectedTypes.length > 0 || pending().nodes.length > 0}>
              <span sx={styles.muted}>
                This affects {pending().affectedTypes.length}{" "}
                {pending().affectedTypes.length === 1 ? "dependent type" : "dependent types"} and{" "}
                {pending().nodes.length} {pending().nodes.length === 1 ? "node" : "nodes"}.
              </span>
            </Show>
            <div sx={styles.row}>
              <Button
                type="button"
                size="sm"
                disabled={busy() || !props.canEdit}
                onClick={() => void confirm()}
              >
                Confirm changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy()}
                onClick={() => {
                  setImpact(null);
                  setError("");
                }}
              >
                Cancel changes
              </Button>
            </div>
          </div>
        )}
      </Show>
      <div sx={styles.typeList}>
        <For
          each={filteredDefinitions()}
          fallback={
            <span sx={styles.empty}>
              {props.search.trim() === ""
                ? `No ${kind() === "Struct" ? "structs" : "enums"} yet.`
                : `No ${kind() === "Struct" ? "structs" : "enums"} found.`}
            </span>
          }
        >
          {(definition) => (
            <div sx={styles.typeItem}>
              <div sx={styles.row}>
                <button
                  type="button"
                  sx={styles.typeName}
                  disabled={disabled()}
                  aria-label={`Edit type ${definition.name}`}
                  onClick={() => {
                    setDraft(definition);
                    setError("");
                  }}
                >
                  {definition.name}
                </button>
                <button
                  type="button"
                  sx={styles.iconButton}
                  disabled={disabled()}
                  aria-label={`Delete type ${definition.name}`}
                  title="Delete"
                  onClick={() => void preview({ _tag: "Delete", id: definition.id })}
                >
                  <IconTablerTrash {...stylex.attrs(styles.icon)} />
                </button>
              </div>
              <For each={diagnostics().filter((diagnostic) => diagnostic.id === definition.id)}>
                {(diagnostic) => <span sx={styles.warning}>{diagnostic.reason}</span>}
              </For>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
