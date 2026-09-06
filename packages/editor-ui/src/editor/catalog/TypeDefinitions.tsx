import { TypeDefinition, type Project } from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import * as stylex from "@stylexjs/stylex";
import { QueryClient, useMutation } from "@tanstack/solid-query";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { AddButton } from "../../ui/AddButton";
import { Button } from "../../ui/Button";
import { DataTypePicker } from "../../ui/DataTypePicker";
import { SearchInput } from "./SearchInput";

const styles = stylex.create({
  panel: {
    alignSelf: "flex-start",
    borderInline: `1px solid ${colors.gray5}`,
    display: "flex",
    flex: 1,
    flexDirection: "column",
    fontSize: 12,
    minHeight: 0,
    minWidth: 0,
    width: "100%",
    maxWidth: 960,
  },
  main: {
    display: "flex",
    flex: 1,
    flexDirection: { default: "column", "@media (min-width: 640px)": "row" },
    minHeight: 0,
    minWidth: 0,
  },
  navigation: {
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: { default: 1, "@media (min-width: 640px)": 0 },
    borderRightColor: colors.gray5,
    borderRightStyle: "solid",
    borderRightWidth: 1,
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    maxHeight: { default: 220, "@media (min-width: 640px)": "none" },
    minHeight: 0,
    width: { default: "100%", "@media (min-width: 640px)": 224 },
  },
  detail: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    overflowY: "auto",
  },
  search: {
    backgroundColor: colors.gray2,
    borderBottomColor: colors.gray6,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexShrink: 0,
    height: 32,
    width: "100%",
  },
  kindTabs: {
    alignItems: "center",
    backgroundColor: colors.gray2,
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexShrink: 0,
    height: 32,
  },
  kindTab: {
    alignSelf: "stretch",
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    color: colors.gray10,
    flex: 1,
    fontSize: 11,
    fontWeight: 500,
    outline: "none",
    ":focus-visible": { boxShadow: `inset 0 0 0 1px ${colors.focus}` },
  },
  activeKind: { borderBottomColor: colors.focus, color: colors.gray12 },
  inactiveKind: { borderBottomColor: "transparent" },
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
    padding: 16,
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
  warning: {
    color: colors.red11,
    backgroundColor: colors.red2,
    padding: 6,
    borderRadius: 2,
    overflowWrap: "anywhere",
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
  typeList: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflowY: "auto",
  },
  typeName: {
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    fontSize: 12,
    minWidth: 0,
    overflow: "hidden",
    paddingBlock: 5,
    paddingInline: 8,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  },
  selectedType: { backgroundColor: colors.gray4, boxShadow: `inset -2px 0 0 ${colors.focus}` },
  empty: {
    color: colors.gray9,
    fontSize: 12,
    fontStyle: "italic",
    padding: 12,
    textAlign: "center",
  },
  detailEmpty: { alignItems: "center", display: "flex", flex: 1, justifyContent: "center" },
});

type Field = typeof DataType.Field.Type;
function defaultName(base: string, items: readonly { name: string }[]) {
  const names = new Set(items.map((item) => item.name));
  let name = base;
  for (let index = 2; names.has(name); index++) name = `${base} ${index}`;
  return name;
}

function Fields(props: {
  fields: readonly Field[];
  definitions: DataType.Definitions;
  disabled: boolean;
  onChange: (fields: readonly Field[], commit?: boolean) => void;
  onCommit: () => void;
}) {
  const update = (index: number, field: Field, commit = false) =>
    props.onChange(
      props.fields.map((item, i) => (i === index ? field : item)),
      commit,
    );
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
                onBlur={() => props.onCommit()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <button
                type="button"
                sx={styles.iconButton}
                aria-label={`Remove field ${index + 1}`}
                title="Remove field"
                disabled={props.disabled}
                onClick={() => {
                  props.onChange(
                    props.fields.filter((_, i) => i !== index),
                    true,
                  );
                }}
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
                if (field) update(index, { ...field, type }, true);
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
        onClick={() => {
          props.onChange(
            [...props.fields, { name: defaultName("field", props.fields), type: DataType.String }],
            true,
          );
        }}
      >
        <IconBiPlus {...stylex.attrs(styles.icon)} /> Add field
      </Button>
    </div>
  );
}

export function TypeDefinitions(props: {
  project: Pick<Project.Model, "types" | "graphs"> | null;
  canEdit: boolean;
  onPreview: (change: TypeDefinition.Change) => Promise<TypeDefinition.Impact>;
  onConfirm: (token: string) => Promise<unknown>;
}) {
  const [kind, setKind] = createSignal<"Struct" | "Enum">("Struct");
  const [selectedId, setSelectedId] = createSignal<DataType.DefinitionId | null>(null);
  const [search, setSearch] = createSignal("");
  const definitions = createMemo(() => props.project?.types ?? {});
  const selected = createMemo(() => {
    const id = selectedId();
    return id === null ? null : (definitions()[id] ?? null);
  });
  const [draft, setDraft] = createSignal<DataType.Definition | null>(selected);
  const choices = createMemo(() => {
    const value = draft();
    return value ? { ...definitions(), [value.id]: value } : definitions();
  });
  const diagnostics = createMemo(() => {
    const value = draft();
    return value
      ? TypeDefinition.validateChange(definitions(), { _tag: "Upsert", definition: value })
      : [];
  });
  const canEdit = createMemo(() => props.canEdit);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { networkMode: "always", retry: false } },
  });
  onCleanup(() => queryClient.clear());
  const mutation = useMutation(
    () => ({
      mutationFn: async (change: TypeDefinition.Change) => {
        if (!canEdit()) throw new Error("The editor is read only or disconnected.");
        const review = await props.onPreview(change);
        await props.onConfirm(review.token);
        if (change._tag === "Upsert") {
          setSelectedId(change.definition.id);
          setDraft(change.definition);
        } else {
          setSelectedId(null);
          setDraft(null);
        }
      },
    }),
    () => queryClient,
  );
  const busy = createMemo(() => mutation.isPending);
  const disabled = createMemo(() => busy() || !canEdit());
  const error = createMemo(() => mutation.error);
  const failedChange = createMemo(() => mutation.variables);
  const save = (value = draft()) => {
    if (!value || disabled()) return;
    setDraft(value);
    if (
      TypeDefinition.validateChange(definitions(), { _tag: "Upsert", definition: value }).length > 0
    )
      return;
    if (JSON.stringify(value) === JSON.stringify(selected())) return;
    mutation.mutate({ _tag: "Upsert", definition: value });
  };
  // Solid batches writes; commit after the input event's draft update has settled.
  const commit = () => queueMicrotask(() => save());
  const create = (kind: "Struct" | "Enum") => {
    if (disabled()) return;
    setSearch("");
    const base = {
      id: DataType.DefinitionId.make(crypto.randomUUID()),
      name: defaultName(
        kind === "Struct" ? "New Struct" : "New Enum",
        Object.values(definitions()),
      ),
    };
    mutation.mutate({
      _tag: "Upsert",
      definition:
        kind === "Struct"
          ? { ...base, _tag: "Struct", fields: [] }
          : { ...base, _tag: "Enum", variants: [{ name: "Variant", fields: [] }] },
    });
  };
  const filteredDefinitions = createMemo(() => {
    const query = search().trim().toLowerCase();
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
      <div sx={styles.main}>
        <div sx={styles.navigation}>
          <div sx={styles.kindTabs}>
            <button
              type="button"
              sx={[styles.kindTab, kind() === "Struct" ? styles.activeKind : styles.inactiveKind]}
              aria-pressed={kind() === "Struct" ? "true" : "false"}
              disabled={busy()}
              onClick={() => {
                setKind("Struct");
                setSelectedId(null);
                setDraft(null);
                mutation.reset();
              }}
            >
              Structs
            </button>
            <button
              type="button"
              sx={[styles.kindTab, kind() === "Enum" ? styles.activeKind : styles.inactiveKind]}
              aria-pressed={kind() === "Enum" ? "true" : "false"}
              disabled={busy()}
              onClick={() => {
                setKind("Enum");
                setSelectedId(null);
                setDraft(null);
                mutation.reset();
              }}
            >
              Enums
            </button>
          </div>
          <div sx={styles.search}>
            <SearchInput
              label="Search types"
              placeholder="Search Types"
              value={search()}
              onChange={setSearch}
            />
            <AddButton
              aria-label={`New ${kind() === "Struct" ? "struct" : "enum"}`}
              title={`New ${kind() === "Struct" ? "struct" : "enum"}`}
              disabled={disabled()}
              onClick={() => create(kind())}
            />
          </div>
          <div sx={styles.typeList}>
            <For
              each={filteredDefinitions()}
              fallback={
                <span sx={styles.empty}>
                  {search().trim() === ""
                    ? `No ${kind() === "Struct" ? "structs" : "enums"} yet.`
                    : `No ${kind() === "Struct" ? "structs" : "enums"} found.`}
                </span>
              }
            >
              {(definition) => (
                <button
                  type="button"
                  sx={[styles.typeName, draft()?.id === definition.id ? styles.selectedType : null]}
                  aria-current={draft()?.id === definition.id ? "page" : undefined}
                  disabled={busy()}
                  onClick={() => {
                    setSelectedId(definition.id);
                    setDraft(definition);
                    mutation.reset();
                  }}
                >
                  {definition.name}
                </button>
              )}
            </For>
          </div>
        </div>
        <div sx={styles.detail}>
          <Show when={error()}>
            <div role="alert" sx={[styles.warning, styles.alert]}>
              Could not save this change. Your edit is still here; try again.
              <Button
                type="button"
                size="sm"
                variant="text"
                disabled={disabled()}
                onClick={() => {
                  const change = failedChange();
                  if (change?._tag === "Upsert" && draft()?.id === change.definition.id) save();
                  else if (change) mutation.mutate(change);
                }}
              >
                Retry
              </Button>
            </div>
          </Show>
          <Show
            when={draft()}
            fallback={
              <span sx={[styles.empty, styles.detailEmpty]}>Select a type to view its shape.</span>
            }
          >
            {(value) => (
              <div sx={styles.editor} aria-label="Type authoring">
                <span sx={styles.editorTitle}>
                  Edit {value()._tag === "Struct" ? "struct" : "tagged enum"}
                </span>
                <div sx={styles.editorHeader}>
                  <input
                    sx={[styles.input, styles.nameInput]}
                    aria-label="Type name"
                    placeholder="Type name"
                    value={value().name}
                    disabled={disabled()}
                    onInput={(event) => setDraft({ ...value(), name: event.currentTarget.value })}
                    onBlur={commit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <Show when={definitions()[value().id] !== undefined}>
                    <button
                      type="button"
                      sx={styles.iconButton}
                      disabled={disabled()}
                      aria-label={`Delete type ${value().name}`}
                      title="Delete type"
                      onClick={() => mutation.mutate({ _tag: "Delete", id: value().id })}
                    >
                      <IconTablerTrash {...stylex.attrs(styles.icon)} />
                    </button>
                  </Show>
                </div>
                <For each={diagnostics()}>
                  {(diagnostic) => <span sx={styles.warning}>{diagnostic.reason}</span>}
                </For>
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
                      onChange={(fields, commit) => {
                        const next = { ...struct(), fields };
                        if (commit) save(next);
                        else setDraft(next);
                      }}
                      onCommit={commit}
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
                                  onBlur={commit}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                  }}
                                />
                                <button
                                  type="button"
                                  sx={styles.iconButton}
                                  aria-label={`Remove variant ${index + 1}`}
                                  title="Remove variant"
                                  disabled={disabled() || enumeration().variants.length === 1}
                                  onClick={() => {
                                    save({
                                      ...enumeration(),
                                      variants: enumeration().variants.filter(
                                        (_, i) => i !== index,
                                      ),
                                    });
                                  }}
                                >
                                  <IconTablerTrash {...stylex.attrs(styles.icon)} />
                                </button>
                              </div>
                              <Fields
                                fields={enumeration().variants[index]?.fields ?? []}
                                definitions={choices()}
                                disabled={disabled()}
                                onChange={(fields, commit) => {
                                  const next = {
                                    ...enumeration(),
                                    variants: enumeration().variants.map((variant, i) =>
                                      i === index ? { ...variant, fields } : variant,
                                    ),
                                  };
                                  if (commit) save(next);
                                  else setDraft(next);
                                }}
                                onCommit={commit}
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
                        onClick={() => {
                          save({
                            ...enumeration(),
                            variants: [
                              ...enumeration().variants,
                              { name: defaultName("Variant", enumeration().variants), fields: [] },
                            ],
                          });
                        }}
                      >
                        <IconBiPlus {...stylex.attrs(styles.icon)} /> Add variant
                      </Button>
                    </>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>
    </section>
  );
}
